const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const Conversation = require("../../backend/commonModules/chatModule/models/Conversation");
const Message = require("../../backend/commonModules/chatModule/models/Message");
const { User } = require("../../backend/models/UserModel");
const Trade = require("../../backend/models/Trade");
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
  let blocked;
  let connected;
  let trade;
  let tradeFilter;
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
      [Trade, "findOne", "tradeFindOne"],
      [connectionUtil, "isBlockedBetween", "isBlocked"],
      [connectionUtil, "isActivelyConnected", "isConnected"],
      [communication, "sendUserNotifications", "notify"],
      [engagement, "logEngagementService", "engagement"],
    ]) original[name] = object[method];
    originalController = require.cache[controllerPath];
    connectionUtil.isBlockedBetween = async () => blocked;
    connectionUtil.isActivelyConnected = async () => connected;
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
    blocked = false;
    connected = true;
    trade = { requesterId: senderId, responderId: recipientId };
    tradeFilter = null;
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
    Trade.findOne = (filter) => {
      tradeFilter = filter;
      return { select: () => ({ lean: async () => trade }) };
    };
  });

  after(() => {
    Conversation.findById = original.findById;
    Conversation.updateOne = original.updateOne;
    Message.create = original.create;
    Message.updateMany = original.updateMany;
    Message.find = original.find;
    Message.countDocuments = original.countDocuments;
    User.findById = original.userFind;
    Trade.findOne = original.tradeFindOne;
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

  it("accepts direct sends for a collaboration while retaining trade access rules", async () => {
    conversation.type = "project";
    conversation.tradeId = new mongoose.Types.ObjectId();
    connected = false;
    await send("direct");
    assert.equal(String(tradeFilter._id), String(conversation.tradeId));
    assert.equal(String(tradeFilter.$or[0].requesterId), String(senderId));
    assert.equal(emitted.find((item) => item.event === "chatUpdated").payload.unreadCount, 4);
    await send("project");
    assert.equal(conversation.unreadCounts.get(String(recipientId)), 5);
  });

  it("rejects direct sends to blocked or unauthorized collaborations and group chats", async () => {
    conversation.type = "project";
    conversation.tradeId = new mongoose.Types.ObjectId();
    const body = {
      conversationId: String(conversationId),
      conversationType: "direct",
      messageType: "text",
      messageContent: "Hello",
    };
    blocked = true;
    await supertest(app).post("/message").send(body).expect(403);
    blocked = false;
    trade = null;
    await supertest(app).post("/message").send(body).expect(403);
    trade = { requesterId: senderId, responderId: recipientId };
    conversation.participants[0].isActive = false;
    await supertest(app).post("/message").send(body).expect(403);
    conversation.participants[0].isActive = true;
    conversation.type = "group";
    await supertest(app).post("/message").send(body).expect(400);
    assert.equal(conversation.saves, undefined);
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
