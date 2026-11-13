const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const Circle = require("../../backend/models/Circle");
const CircleMember = require("../../backend/models/CircleMember");
const Event = require("../../backend/models/Event");
const communication = require("../../backend/controllers/communicationController");

describe("Circle Event name suggestions", () => {
  const circleId = new mongoose.Types.ObjectId();
  const creatorId = new mongoose.Types.ObjectId();
  const memberId = new mongoose.Types.ObjectId();
  const circle = { _id: circleId, creatorId, name: "Book Club", deletedAt: null };
  const originalCircleFindOne = Circle.findOne;
  const originalMemberFindOne = CircleMember.findOne;
  const originalSendNotifications = communication.sendUserNotifications;
  const servicePath = require.resolve("../../backend/roles/user/events/service");
  let notifications;
  let service;

  before(() => {
    communication.sendUserNotifications = (notification) => notifications.push(notification);
    delete require.cache[servicePath];
    service = require(servicePath);
  });

  beforeEach(() => {
    notifications = [];
    Circle.findOne = () => Promise.resolve(circle);
    CircleMember.findOne = (filter) => ({
      lean: async () => ({ role: String(filter.userId) === String(creatorId) ? "organizer" : "member" }),
    });
  });

  after(() => {
    Circle.findOne = originalCircleFindOne;
    CircleMember.findOne = originalMemberFindOne;
    communication.sendUserNotifications = originalSendNotifications;
    delete require.cache[servicePath];
  });

  it("notifies only the Circle creator with the suggested Event name", async () => {
    const result = await service.suggestEvent(memberId, String(circleId), { name: "Summer picnic" });

    assert.deepEqual(result, {
      circleId: String(circleId),
      eventName: "Summer picnic",
      notificationSent: true,
    });
    assert.equal(notifications.length, 1);
    assert.deepEqual(notifications[0].recipientIds, [String(creatorId)]);
    assert.equal(notifications[0].sender, memberId);
    assert.equal(notifications[0].objectId, circleId);
    assert.match(notifications[0].body, /Summer picnic/);
    assert.equal(notifications[0].data.eventName, "Summer picnic");
  });

  it("does not notify the creator when they suggest an Event themselves", async () => {
    const result = await service.suggestEvent(creatorId, String(circleId), { name: "Book launch" });

    assert.equal(result.notificationSent, false);
    assert.deepEqual(notifications, []);
  });

  it("requires an active Circle member and a valid Event name", async () => {
    CircleMember.findOne = () => ({ lean: async () => null });
    await assert.rejects(service.suggestEvent(memberId, String(circleId), { name: "Meetup" }), {
      statusCode: 403,
      translationKey: "circle_membership_required",
    });

    CircleMember.findOne = (filter) => ({
      lean: async () => ({ role: String(filter.userId) === String(creatorId) ? "organizer" : "member" }),
    });
    await assert.rejects(service.suggestEvent(memberId, String(circleId), { name: "  " }), {
      statusCode: 400,
      translationKey: "event_name_required",
    });
    await assert.rejects(service.suggestEvent(memberId, String(circleId), { name: "x".repeat(161) }), {
      statusCode: 400,
      translationKey: "event_name_invalid",
    });
    assert.deepEqual(notifications, []);
  });

  it("removes suggestion metadata from the Event schema", () => {
    assert.equal(Event.schema.path("suggestedBy"), undefined);
    assert.equal(Event.schema.path("suggestionStatus"), undefined);
    assert.equal(Event.schema.path("approvedBy"), undefined);
  });
});
