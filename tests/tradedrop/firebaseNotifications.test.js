const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const firebasePath = require.resolve("firebase-admin");
const configPath = require.resolve("../../backend/config/firebaseAdmin");
const controllerPath = require.resolve("../../backend/controllers/communicationController");
const { Devices } = require("../../backend/models/Devices");
const { NotificationExp } = require("../../backend/models/Notifications");
const NotificationPreferences = require("../../backend/models/NotificationPreferences");

describe("Firebase Admin configuration", () => {
  const keys = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_DATABASE_URL"];
  let originalEnv;
  let originalConfig;
  let originalFirebase;

  beforeEach(() => {
    require("firebase-admin");
    originalFirebase = require.cache[firebasePath].exports;
    originalConfig = require.cache[configPath];
    originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    delete require.cache[configPath];
  });

  afterEach(() => {
    require.cache[firebasePath].exports = originalFirebase;
    if (originalConfig) require.cache[configPath] = originalConfig;
    else delete require.cache[configPath];
    for (const key of keys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("initializes with environment credentials and expands escaped newlines", () => {
    process.env.FIREBASE_PROJECT_ID = "test-project";
    process.env.FIREBASE_CLIENT_EMAIL = "test@example.invalid";
    process.env.FIREBASE_PRIVATE_KEY = "first\\nsecond\\n";
    let account;
    let options;
    const sdk = {
      apps: [],
      credential: { cert: (value) => { account = value; return "credential"; } },
      initializeApp: (value) => { options = value; },
    };
    require.cache[firebasePath].exports = sdk;

    assert.equal(require(configPath), sdk);
    assert.deepEqual(account, {
      projectId: "test-project",
      clientEmail: "test@example.invalid",
      privateKey: "first\nsecond\n",
    });
    assert.deepEqual(options, { credential: "credential" });
  });

  it("reports incomplete environment credentials without falling back to a file", () => {
    process.env.FIREBASE_PROJECT_ID = "test-project";
    let logged;
    const originalError = console.error;
    const sdk = { apps: [], credential: { cert: () => assert.fail("must not use a credential") } };
    require.cache[firebasePath].exports = sdk;
    console.error = (...args) => { logged = args.join(" "); };
    try {
      require(configPath);
      assert.match(logged, /FIREBASE_PROJECT_ID.*FIREBASE_CLIENT_EMAIL.*FIREBASE_PRIVATE_KEY/);
    } finally {
      console.error = originalError;
    }
  });
});

describe("Background user notification delivery", () => {
  const userId = new mongoose.Types.ObjectId();
  const disabledId = new mongoose.Types.ObjectId();
  const originals = {
    preferencesFind: NotificationPreferences.find,
    devicesFind: Devices.find,
    insertMany: NotificationExp.insertMany,
  };
  let originalConfig;
  let originalConfigExports;
  let originalController;
  let controller;
  let saved;
  let batches;
  let deviceQuery;
  let failureCount;

  before(() => {
    originalConfig = require.cache[configPath];
    originalController = require.cache[controllerPath];
    if (!originalConfig) require(configPath);
    originalConfigExports = require.cache[configPath].exports;
    require.cache[configPath].exports = {
      messaging: () => ({
        sendEachForMulticast: async (payload) => {
          batches.push(payload);
          return { failureCount };
        },
      }),
    };
    delete require.cache[controllerPath];
    controller = require(controllerPath);
  });

  beforeEach(() => {
    saved = [];
    batches = [];
    deviceQuery = null;
    failureCount = 0;
    NotificationPreferences.find = () => ({
      select: () => ({ lean: async () => [{ userId: disabledId }] }),
    });
    NotificationExp.insertMany = async (rows) => { saved.push(...rows); };
    Devices.find = (query) => {
      deviceQuery = query;
      return {
        select: async () => [{
          userId,
          devices: Array.from({ length: 501 }, (_, index) => ({ deviceId: `token-${index}` }))
            .concat([{ deviceId: "token-0" }]),
        }],
      };
    };
  });

  after(() => {
    NotificationPreferences.find = originals.preferencesFind;
    Devices.find = originals.devicesFind;
    NotificationExp.insertMany = originals.insertMany;
    if (originalConfig) {
      originalConfig.exports = originalConfigExports;
      require.cache[configPath] = originalConfig;
    }
    else delete require.cache[configPath];
    if (originalController) require.cache[controllerPath] = originalController;
    else delete require.cache[controllerPath];
  });

  async function flushBackground() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it("saves for enabled recipients and delivers string-valued data in batches of at most 500", async () => {
    await controller.sendUserNotifications({
      recipientIds: [userId, disabledId],
      title: "Title",
      body: "Body",
      data: { type: "event", count: 2 },
      meta: { nested: true },
      sender: userId,
    });
    await flushBackground();
    assert.equal(saved.length, 1);
    assert.equal(String(saved[0].receiverId), String(userId));
    assert.deepEqual(deviceQuery.userId.$in, [userId]);
    assert.deepEqual(batches.map((batch) => batch.tokens.length), [500, 1]);
    assert.equal(batches[0].notification.title, "Title");
    assert.equal(batches[0].data.count, "2");
    assert.equal(batches[0].data.meta, '{"nested":true}');
    assert.equal(batches[0].data.subjectId, String(userId));
  });

  it("sends without creating inbox records when saveNotification is false", async () => {
    await controller.sendUserNotifications({
      recipientIds: [userId],
      title: "Title",
      body: "Body",
      saveNotification: false,
    });
    await flushBackground();
    assert.equal(saved.length, 0);
    assert.equal(batches.length, 2);
  });

  it("reports partial Firebase delivery failures without logging device tokens", async () => {
    failureCount = 1;
    const originalError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.join(" "));
    try {
      await controller.sendUserNotifications({ recipientIds: [userId], title: "Title", body: "Body" });
      await flushBackground();
      assert.match(logs[0], /failed for 2 device/);
      assert.doesNotMatch(logs[0], /token-/);
    } finally {
      console.error = originalError;
    }
  });
});
