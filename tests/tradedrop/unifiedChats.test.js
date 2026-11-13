const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const Conversation = require("../../backend/commonModules/chatModule/models/Conversation");
const controller = require("../../backend/commonModules/chatModule/controllers/messageController");
const routes = require("../../backend/commonModules/chatModule/routes/messageRoutes");

describe("Unified chat inbox", () => {
  const userId = new mongoose.Types.ObjectId();
  const conversationId = new mongoose.Types.ObjectId();
  const originalAggregate = Conversation.aggregate;
  let pipelines;
  let app;

  before(() => {
    app = express();
    app.use((req, res, next) => {
      req.user = { _id: String(userId), timezone: "UTC" };
      req.__ = (key) => key;
      next();
    });
    app.get("/chat", controller.fetchUnifiedChats);
    app.get("/legacy", controller.fetchChats);
  });

  beforeEach(() => {
    pipelines = [];
    Conversation.aggregate = async (pipeline) => {
      pipelines.push(pipeline);
      if (pipeline.some((stage) => stage.$count)) return [{ count: 3 }];
      return [{
        _id: conversationId,
        type: "group",
        groupName: "Circle",
        participants: [],
        userDetails: [],
        currentParticipant: { chatState: "favorite" },
        unreadCounts: { [String(userId)]: 2 },
      }];
    };
  });

  after(() => {
    Conversation.aggregate = originalAggregate;
  });

  it("uses the authenticated route and applies filters before pagination and counting", async () => {
    const layer = routes.stack.find((item) => item.route?.path === "/chat");
    assert.ok(layer?.route.methods.get);
    assert.ok(layer.route.stack.length > 1);

    const { body } = await supertest(app)
      .get("/chat?category=circles&chatState=favorite&keyword=Circle&page=2&limit=1")
      .expect(200);
    assert.equal(body.data[0].conversationId, String(conversationId));
    assert.equal(body.data[0].chatState, "favorite");
    assert.equal(body.data[0].unreadCount, 2);
    assert.deepEqual(body.meta, { currentPage: 2, totalPages: 3, totalRecords: 3, limit: 1 });
    assert.equal(pipelines.length, 2);
    for (const pipeline of pipelines) {
      const match = pipeline[0].$match;
      assert.equal(match.type, "group");
      assert.equal(String(match.participants.$elemMatch.user), String(userId));
      assert.ok(match.participants.$elemMatch.user instanceof mongoose.Types.ObjectId);
      assert.equal(match.participants.$elemMatch.isActive, true);
      assert.deepEqual(match.participants.$elemMatch.chatState.$in, ["favorite"]);
      assert.ok(pipeline.some((stage) => stage.$match?.$or?.some((part) => part.groupName?.$regex === "Circle")));
      const membershipMatch = pipeline.find((stage) => stage.$lookup?.from === "circlemembers").$lookup.pipeline[0].$match;
      assert.equal(membershipMatch.status, "active");
      assert.equal(String(membershipMatch.userId), String(userId));
      assert.deepEqual(membershipMatch.$expr, { $eq: ["$circleId", "$$circleId"] });
      const circleMatch = pipeline.find((stage) => stage.$lookup?.from === "circles").$lookup.pipeline[0].$match;
      assert.equal(circleMatch.deletedAt, null);
      assert.deepEqual(circleMatch.$expr, { $eq: ["$_id", "$$circleId"] });
      assert.ok(pipeline.some((stage) => stage.$match?.$or?.some((part) =>
        part["_activeCircle.0"] && part["_circleMembership.0"])));
    }
    const pagePipeline = pipelines.find((pipeline) => pipeline.some((stage) => stage.$skip !== undefined));
    assert.equal(pagePipeline.find((stage) => stage.$skip !== undefined).$skip, 1);
    assert.equal(pagePipeline.find((stage) => stage.$limit !== undefined).$limit, 1);
  });

  it("restricts collaboration chats to active trades involving the viewer in All and Collaborations", async () => {
    for (const category of ["all", "collaborations"]) {
      pipelines = [];
      await supertest(app).get(`/chat?category=${category}`).expect(200);
      for (const pipeline of pipelines) {
        const tradeLookup = pipeline.find((stage) => stage.$lookup?.from === "trades").$lookup;
        const tradeMatch = tradeLookup.pipeline[0].$match;
        assert.equal(tradeMatch.status, "active");
        assert.equal(String(tradeMatch.$or[0].requesterId), String(userId));
        assert.equal(String(tradeMatch.$or[1].responderId), String(userId));
        assert.deepEqual(tradeMatch.$expr, { $eq: ["$_id", "$$tradeId"] });
        assert.ok(pipeline.some((stage) => stage.$match?.$or?.some((part) => part["_chatTrade.0"])));
      }
    }
  });

  it("includes the linked Drop ID for collaboration chats in both listing routes", async () => {
    const dropId = new mongoose.Types.ObjectId();
    const peerId = new mongoose.Types.ObjectId();
    Conversation.aggregate = async (pipeline) => {
      pipelines.push(pipeline);
      if (pipeline.some((stage) => stage.$count)) return [{ count: 2 }];
      return [
        {
          _id: conversationId, type: "project", groupName: "Collaboration",
          userDetails: [
            { _id: userId, name: "Viewer" },
            { _id: peerId, name: "Collaborator", profileIcon: "https://example.com/avatar.png" },
          ],
          _chatTrade: [{ dropId }], unreadCounts: {},
        },
        {
          _id: new mongoose.Types.ObjectId(), type: "group", groupName: "Circle",
          userDetails: [], unreadCounts: {},
        },
      ];
    };
    for (const route of ["/chat?category=collaborations", "/chat?category=all", "/legacy"]) {
      pipelines = [];
      const { body } = await supertest(app).get(route).expect(200);
      assert.equal(body.data[0].dropId, String(dropId));
      assert.deepEqual(body.data[0].otherUser, {
        _id: String(peerId),
        name: "Collaborator",
        profileIcon: "https://example.com/avatar.png",
      });
      assert.equal(body.data[0].chatName, "Collaboration");
      assert.equal("dropId" in body.data[1], false);
      assert.equal("otherUser" in body.data[1], false);
      const paginated = pipelines.find((pipeline) => pipeline.some((stage) => stage.$skip !== undefined));
      const lookup = paginated.find((stage) => stage.$lookup?.from === "trades").$lookup;
      assert.equal(lookup.pipeline[1].$project.dropId, 1);
      assert.equal(String(lookup.pipeline[0].$match.$or[0].requesterId), String(userId));
      if (route === "/legacy") {
        assert.equal(lookup.pipeline[0].$match.status, undefined);
        assert.ok(paginated.indexOf(paginated.find((stage) => stage.$limit)) <
          paginated.indexOf(paginated.find((stage) => stage.$lookup?.from === "trades")));
      }
    }
  });

  it("returns a null Drop ID for legacy project chats without an accessible linked trade", async () => {
    Conversation.aggregate = async (pipeline) => pipeline.some((stage) => stage.$count)
      ? [{ count: 1 }]
      : [{ _id: conversationId, type: "project", userDetails: [], _chatTrade: [], unreadCounts: {} }];
    const { body } = await supertest(app).get("/legacy").expect(200);
    assert.equal(body.data[0].dropId, null);
    assert.equal(body.data[0].otherUser, null);
  });

  it("resolves relative collaborator profile images and handles missing images", async () => {
    const originalBase = process.env.S3_BASE_URL;
    const peerId = new mongoose.Types.ObjectId();
    let profileIcon = "avatar.png";
    process.env.S3_BASE_URL = "https://images.example.com/";
    try {
      Conversation.aggregate = async (pipeline) => pipeline.some((stage) => stage.$count)
        ? [{ count: 1 }]
        : [{
            _id: conversationId,
            type: "project",
            userDetails: [{ _id: userId }, { _id: peerId, name: "Peer", profileIcon }],
            _chatTrade: [],
            unreadCounts: {},
          }];
      const withImage = await supertest(app).get("/chat?category=collaborations").expect(200);
      assert.equal(withImage.body.data[0].otherUser.profileIcon, "https://images.example.com/avatar.png");
      profileIcon = null;
      const withoutImage = await supertest(app).get("/chat?category=collaborations").expect(200);
      assert.equal(withoutImage.body.data[0].otherUser.profileIcon, null);
    } finally {
      if (originalBase === undefined) delete process.env.S3_BASE_URL;
      else process.env.S3_BASE_URL = originalBase;
    }
  });

  it("maps categories and rejects unknown categories", async () => {
    for (const [category, expected] of [["people", "direct"], ["circles", "group"], ["collaborations", "project"]]) {
      pipelines = [];
      await supertest(app).get(`/chat?category=${category}`).expect(200);
      assert.equal(pipelines[0][0].$match.type, expected);
    }
    pipelines = [];
    await supertest(app).get("/chat?category=unknown").expect(400);
    assert.equal(pipelines.length, 0);
  });

  it("includes collaborations in All and defaults to inbox chat states", async () => {
    for (const route of ["/chat", "/chat?category=all"]) {
      pipelines = [];
      await supertest(app).get(route).expect(200);
      for (const pipeline of pipelines) {
        assert.deepEqual(pipeline[0].$match.type, { $in: ["direct", "group", "project"] });
        assert.deepEqual(pipeline[0].$match.participants.$elemMatch.chatState.$in, ["default", "favorite"]);
      }
    }
  });
});
