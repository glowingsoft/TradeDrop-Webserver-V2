const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const TapIn = require("../../backend/models/TapIn");
const { Drop } = require("../../backend/models/Drop");
const Trade = require("../../backend/models/Trade");
const Conversation = require("../../backend/commonModules/chatModule/models/Conversation");
const shared = require("../../backend/roles/user/_shared/tradeShared");
const communication = require("../../backend/controllers/communicationController");

describe("accept and decline Tap In", () => {
  const tapInId = new mongoose.Types.ObjectId();
  const dropId = new mongoose.Types.ObjectId();
  const requesterId = new mongoose.Types.ObjectId();
  const responderId = new mongoose.Types.ObjectId();
  const otherRequesterId = new mongoose.Types.ObjectId();
  const tradeId = new mongoose.Types.ObjectId();
  const conversationId = new mongoose.Types.ObjectId();
  const session = {};
  const originalMethods = [];
  let acceptTapIn;
  let declineTapIn;
  let notifications;
  let status;
  let committed;
  let dropUpdate;

  function replace(model, method, replacement) {
    originalMethods.push([model, method, model[method]]);
    model[method] = replacement;
  }

  before(() => {
    const servicePath = require.resolve("../../backend/roles/user/tapIns/service");
    const originalService = require.cache[servicePath];
    const originalTransaction = shared.withTransaction;
    const originalCapacity = shared.assertTradeCapacity;
    const originalNotifications = communication.sendUserNotifications;
    try {
      shared.withTransaction = async (fn) => {
        const result = await fn(session);
        committed = true;
        return result;
      };
      shared.assertTradeCapacity = async () => {};
      communication.sendUserNotifications = async (notification) => { notifications.push(notification); };
      delete require.cache[servicePath];
      ({ acceptTapIn, declineTapIn } = require(servicePath));
    } finally {
      shared.withTransaction = originalTransaction;
      shared.assertTradeCapacity = originalCapacity;
      communication.sendUserNotifications = originalNotifications;
      if (originalService) require.cache[servicePath] = originalService;
      else delete require.cache[servicePath];
    }
  });

  beforeEach(() => {
    notifications = [];
    status = "pending";
    committed = false;
    dropUpdate = null;
    const tapIn = () => ({ _id: tapInId, dropId, requesterId, responderId, status, deletedAt: null, tradeId });
    replace(TapIn, "findOneAndUpdate", (filter, update) => ({
      lean: async () => {
        assert.equal(filter.status, "pending");
        if (status !== "pending") return null;
        status = update.$set.status;
        return tapIn();
      },
    }));
    replace(TapIn, "findById", () => ({ session: () => ({ lean: async () => tapIn() }) }));
    replace(Drop, "findOneAndUpdate", () => ({
      lean: async () => ({ _id: dropId, ownerId: responderId, status: "closed" }),
    }));
    replace(Drop, "updateOne", async (filter, update, options) => {
      dropUpdate = { filter, update, options };
    });
    replace(TapIn, "find", () => ({
      session: () => ({ lean: async () => [{ requesterId: otherRequesterId }] }),
    }));
    replace(TapIn, "updateMany", async () => ({}));
    const trade = {
      _id: tradeId,
      tradeCode: "T123",
      save: async () => {},
      toObject() {
        return { ...this, tapInId, dropId, requesterId, responderId, status: "active" };
      },
    };
    replace(Trade, "create", async () => [trade]);
    replace(Conversation, "create", async () => [{ _id: conversationId }]);
    replace(TapIn, "findByIdAndUpdate", () => ({ lean: async () => tapIn() }));
  });

  afterEach(() => {
    while (originalMethods.length) {
      const [model, method, original] = originalMethods.pop();
      model[method] = original;
    }
  });

  it("returns the committed acceptance and notifies both requesters", async () => {
    const result = await acceptTapIn(responderId, tapInId);
    assert.equal(committed, true);
    assert.equal(result.tapIn.status, "accepted");
    assert.equal(result.tapIn.tradeId, String(tradeId));
    assert.equal(result.trade._id, String(tradeId));
    assert.equal(result.trade.conversationId, String(conversationId));
    assert.deepEqual(Object.keys(result).sort(), ["tapIn", "trade"]);
    assert.deepEqual(notifications.map((notification) => notification.recipientIds), [
      [String(requesterId)],
      [String(otherRequesterId)],
    ]);

    await assert.rejects(acceptTapIn(responderId, tapInId), (error) =>
      error.statusCode === 409 && error.translationKey === "invalid_status_transition",
    );
  });

  it("returns the committed decline and notifies the requester", async () => {
    const result = await declineTapIn(responderId, tapInId);
    assert.equal(committed, true);
    assert.equal(result._id, String(tapInId));
    assert.equal(result.status, "declined");
    assert.deepEqual(dropUpdate.filter, { _id: dropId, visibility: "direct", deletedAt: null });
    assert.ok(dropUpdate.update.$set.deletedAt instanceof Date);
    assert.equal(dropUpdate.options.session, session);
    assert.equal(notifications.length, 1);
    assert.deepEqual(notifications[0].recipientIds, [String(requesterId)]);
    assert.equal(String(notifications[0].objectId), String(tapInId));

    await assert.rejects(declineTapIn(responderId, tapInId), (error) =>
      error.statusCode === 409 && error.translationKey === "invalid_status_transition",
    );
    assert.equal(notifications.length, 1);
  });
});
