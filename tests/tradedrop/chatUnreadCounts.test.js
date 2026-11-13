const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const Conversation = require("../../backend/commonModules/chatModule/models/Conversation");
const Message = require("../../backend/commonModules/chatModule/models/Message");
const { User } = require("../../backend/models/UserModel");
const connectionUtil = require("../../backend/helperUtils/connectionUtil");
const communication = require("../../backend/controllers/communicationController");
const engagement = require("../../backend/commonModules/appEngagement/engagementEventsService");
const controllerPath = require.resolve("../../backend/commonModules/chatModule/controllers/messageController");

describe("Chat unread counts", () => {
  const senderId = new mongoose.Types.ObjectId();
  const recipientId = new mongoose.Types.ObjectId();
  const secondRecipientId = new mongoose.Types.ObjectId();
  const conversationId = new mongoose.Types.ObjectId();
  const original = {};
  let originalController;
  let controller;
  let conversation;
  let emitted;
  let presenceChecks;
  let app;

  before(() => {
    for (const [object, method, name] of [
      [Conversation, "findById", "findById"],
      [Conversation, "updateOne", "updateOne"],
      [Message, "create", "create"],
      [Message, "updateMany", "updateMany"],
      [Message, "find", "find"],
      [Message, "countDocuments", "countDocuments"],
      [User, "findById", "userFind"],
      [connectionUtil, "isBlockedBetween", "isBlocked"],
      [connectionUtil, "isActivelyConnected", "isConnected"],
      [communication, "sendUserNotifications", "notify"],
      [engagement, "logEngagementService", "engagement"],
    ]) original[name] = object[method];
    originalController = require.cache[controllerPath];
    connectionUtil.isBlockedBetween = async () => false;
    connectionUtil.isActivelyConnected = async () => true;
    communication.sendUserNotifications = async () => {};
    engagement.logEngagementService = async () => {};
    delete require.cache[controllerPath];
    controller = require(controllerPath);
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { _id: senderId, timezone: "UTC", name: "Sender" };
      req.__ = (key) => key;
      req.io = {
        to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
        in: () => {
          presenceChecks += 1;
          return { allSockets: async () => new Set(["connected-socket"]) };
        },
      };
      next();
    });
    app.post("/message", controller.sendMessage);
    app.get("/messages", controller.fetchMessages);
  });

  beforeEach(() => {
    emitted = [];
    presenceChecks = 0;
    conversation = {
      _id: conversationId,
      type: "direct",
      participants: [{ user: senderId, isActive: true }, { user: recipientId, isActive: true }],
      unreadCounts: new Map([[String(senderId), 2], [String(recipientId), 3]]),
      save: async () => { conversation.saves = (conversation.saves || 0) + 1; },
    };
    Conversation.findById = async () => conversation;
    Message.create = async (data) => ({
      _id: new mongoose.Types.ObjectId(),
      createdAt: new Date(),
      toObject: () => ({ ...data }),
    });
    User.findById = () => ({ select: () => ({ lean: async () => ({ name: "Sender" }) }) });
  });

  after(() => {
    Conversation.findById = original.findById;
    Conversation.updateOne = original.updateOne;
    Message.create = original.create;
    Message.updateMany = original.updateMany;
    Message.find = original.find;
    Message.countDocuments = original.countDocuments;
    User.findById = original.userFind;
    connectionUtil.isBlockedBetween = original.isBlocked;
    connectionUtil.isActivelyConnected = original.isConnected;
    communication.sendUserNotifications = original.notify;
    engagement.logEngagementService = original.engagement;
    if (originalController) require.cache[controllerPath] = originalController;
    else delete require.cache[controllerPath];
  });

  async function send(type) {
    await supertest(app).post("/message").send({
      conversationId: String(conversationId),
      conversationType: type,
      messageType: "text",
      messageContent: "Hello",
    }).expect(201);
    await new Promise((resolve) => setImmediate(resolve));
  }

  it("increments and emits unread counts for a connected direct-chat recipient", async () => {
    await send("direct");
    const update = emitted.find((item) => item.room === `user:${recipientId}` && item.event === "chatUpdated");
    assert.equal(update.payload.unreadCount, 4);
    assert.equal(conversation.unreadCounts.get(String(recipientId)), 4);
    assert.equal(conversation.unreadCounts.get(String(senderId)), 2);
    assert.equal(conversation.saves, 1);
    assert.equal(presenceChecks, 0);
    await send("direct");
    assert.equal(conversation.unreadCounts.get(String(recipientId)), 5);
    assert.equal(emitted.filter((item) => item.event === "chatUpdated").at(-1).payload.unreadCount, 5);
  });

  it("emits each group recipient's individual unread count", async () => {
    conversation.type = "group";
    conversation.participants.push({ user: secondRecipientId, isActive: true });
    conversation.unreadCounts.set(String(secondRecipientId), 0);
    await send("group");
    const updates = emitted.filter((item) => item.event === "chatUpdated");
    assert.equal(updates.length, 2);
    assert.equal(updates.find((item) => item.room === `user:${recipientId}`).payload.unreadCount, 4);
    assert.equal(updates.find((item) => item.room === `user:${secondRecipientId}`).payload.unreadCount, 1);
    assert.equal(conversation.unreadCounts.get(String(senderId)), 2);
  });

  it("still resets the viewer's unread count when messages are fetched", async () => {
    Conversation.findById = () => ({ lean: async () => conversation });
    Message.updateMany = async () => ({});
    Conversation.updateOne = async (_filter, update) => {
      assert.equal(update.$set[`unreadCounts.${senderId}`], 0);
      conversation.unreadCounts.set(String(senderId), 0);
    };
    Message.find = () => {
      const query = { sort: () => query, skip: () => query, limit: () => query, lean: async () => [] };
      return query;
    };
    Message.countDocuments = async () => 0;
    await supertest(app).get(`/messages?conversationId=${conversationId}`).expect(200);
    assert.equal(conversation.unreadCounts.get(String(senderId)), 0);
    assert.equal(conversation.unreadCounts.get(String(recipientId)), 3);
  });
});
