const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const { NotificationExp } = require("../../backend/models/Notifications");
const controller = require("../../backend/controllers/notificationsController");
const routes = require("../../backend/routes/notificationsRoutes");

describe("Notification inbox", () => {
  const userId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();
  const originals = {
    find: NotificationExp.find,
    countDocuments: NotificationExp.countDocuments,
    updateMany: NotificationExp.updateMany,
  };
  let notifications;
  let app;

  function matches(notification, filter) {
    if (String(notification.receiverId) !== String(filter.receiverId)) return false;
    if (filter.isRead && filter.isRead.$ne === notification.isRead) return false;
    if (filter.type?.$in && !filter.type.$in.includes(notification.type)) return false;
    if (filter.type?.$regex && !new RegExp(filter.type.$regex, filter.type.$options).test(notification.type)) return false;
    return true;
  }

  before(() => {
    app = express();
    app.use((req, res, next) => {
      req.user = { _id: userId, timezone: "UTC" };
      req.__ = (key) => key;
      next();
    });
    app.get("/notifications", controller.getNotifications);
    app.put("/notifications/read-all", controller.readAllNotifications);
  });

  beforeEach(() => {
    const types = ["event", "event_suggestion", "connection_request", "circle_request", "circle_invitation", "tap_in", "general"];
    notifications = types.map((type, index) => ({
      _id: new mongoose.Types.ObjectId(),
      receiverId: userId,
      type,
      objectType: "test",
      title: type,
      body: type,
      isRead: index === 6,
      createdAt: new Date(Date.UTC(2026, 0, index + 1)),
    }));
    notifications.push({
      _id: new mongoose.Types.ObjectId(),
      receiverId: otherUserId,
      type: "event",
      isRead: false,
      createdAt: new Date(),
    });
    NotificationExp.find = (filter) => {
      let skip = 0;
      let limit = 100;
      const query = {
        select: () => query,
        sort: () => query,
        skip: (value) => { skip = value; return query; },
        limit: (value) => { limit = value; return query; },
        lean: async () => notifications.filter((item) => matches(item, filter))
          .sort((a, b) => b.createdAt - a.createdAt).slice(skip, skip + limit),
      };
      return query;
    };
    NotificationExp.countDocuments = async (filter) => notifications.filter((item) => matches(item, filter)).length;
    NotificationExp.updateMany = async (filter, update) => {
      let modifiedCount = 0;
      for (const notification of notifications) {
        if (matches(notification, filter)) {
          notification.isRead = update.$set.isRead;
          modifiedCount += 1;
        }
      }
      return { modifiedCount };
    };
  });

  after(() => Object.assign(NotificationExp, originals));

  it("filters both results and counts while retaining keyword and pagination", async () => {
    const events = await supertest(app).get("/notifications?filter=events&limit=1&page=2").expect(200);
    assert.deepEqual(events.body.data.map((item) => item.type), ["event"]);
    assert.equal(events.body.meta.totalRecords, 2);
    const allEvents = await supertest(app).get("/notifications?filter=events").expect(200);
    assert.deepEqual(allEvents.body.data.map((item) => item.type), ["event_suggestion", "event"]);
    const allRequests = await supertest(app).get("/notifications?filter=requests").expect(200);
    assert.equal(allRequests.body.meta.totalRecords, 4);
    const requests = await supertest(app).get("/notifications?filter=requests&keyword=circle").expect(200);
    assert.deepEqual(requests.body.data.map((item) => item.type), ["circle_invitation", "circle_request"]);
    assert.equal(requests.body.meta.totalRecords, 2);
    const all = await supertest(app).get("/notifications").expect(200);
    assert.equal(all.body.meta.totalRecords, 7);
    const invalid = await supertest(app).get("/notifications?filter=other").expect(400);
    assert.equal(invalid.body.message, "Notification filter invalid");
  });

  it("marks only the caller's unread notifications and is idempotent", async () => {
    delete notifications[0].isRead;
    const layer = routes.stack.find((item) => item.route?.path === "/read-all");
    assert.ok(layer?.route.methods.put);
    assert.ok(layer.route.stack.length > 1);
    const first = await supertest(app).put("/notifications/read-all").expect(200);
    assert.equal(first.body.data.modifiedCount, 6);
    assert.equal(notifications.find((item) => item.receiverId === otherUserId).isRead, false);
    const second = await supertest(app).put("/notifications/read-all").expect(200);
    assert.equal(second.body.data.modifiedCount, 0);
    const listed = await supertest(app).get("/notifications?filter=events").expect(200);
    assert.ok(listed.body.data.every((item) => item.isRead));
  });

  it("returns an error when the bulk update fails", async () => {
    NotificationExp.updateMany = async () => { throw new Error("database failure"); };
    await supertest(app).put("/notifications/read-all").expect(500);
  });
});
