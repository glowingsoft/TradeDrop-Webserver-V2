const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const Circle = require("../../backend/models/Circle");
const CircleMember = require("../../backend/models/CircleMember");
const ConnectionRequest = require("../../backend/models/ConnectionRequest");
const Event = require("../../backend/models/Event");
const TapIn = require("../../backend/models/TapIn");
const { Drop } = require("../../backend/models/Drop");
const { User } = require("../../backend/models/UserModel");
const controller = require("../../backend/roles/user/activity/controller");

describe("sent activity tap-ins", () => {
  const viewerId = new mongoose.Types.ObjectId();
  const responderId = new mongoose.Types.ObjectId();
  const missingId = new mongoose.Types.ObjectId();
  const dropId = new mongoose.Types.ObjectId();
  const missingDropId = new mongoose.Types.ObjectId();
  const tapInId = new mongoose.Types.ObjectId();
  const originals = [];
  let baseUrl;
  let app;
  let userFilter;
  let dropFilter;

  function replace(model, method, replacement) {
    originals.push([model, method, model[method]]);
    model[method] = replacement;
  }

  function query(items) {
    let skip = 0;
    let limit = items.length;
    const result = {
      sort: () => result,
      skip: (value) => { skip = value; return result; },
      limit: (value) => { limit = value; return result; },
      select: () => result,
      lean: async () => items.slice(skip, skip + limit),
    };
    return result;
  }

  before(() => {
    baseUrl = process.env.S3_BASE_URL;
    process.env.S3_BASE_URL = "https://images.example.com/";
    app = express();
    app.use((req, res, next) => {
      req.user = { _id: viewerId };
      req.__ = (key) => key;
      next();
    });
    app.get("/activity/:tab", controller.get);
    replace(CircleMember, "distinct", async () => []);
    replace(CircleMember, "find", () => query([]));
    replace(CircleMember, "countDocuments", async () => 0);
    for (const model of [Circle, Event]) {
      replace(model, "find", () => query([]));
      replace(model, "countDocuments", async () => 0);
    }
    replace(ConnectionRequest, "find", () => query([{ recipientId: responderId, requesterId: viewerId }]));
    replace(ConnectionRequest, "countDocuments", async () => 1);
    replace(TapIn, "find", (filter) => {
      assert.deepEqual(filter, { requesterId: viewerId, deletedAt: null });
      return query([
        { _id: tapInId, requesterId: viewerId, responderId, dropId, status: "pending" },
        { _id: new mongoose.Types.ObjectId(), requesterId: viewerId, responderId: missingId, dropId: missingDropId, status: "declined" },
      ]);
    });
    replace(TapIn, "countDocuments", async () => 2);
    replace(User, "find", (filter) => {
      userFilter = filter;
      return query([{ _id: responderId, name: "Responder", profileIcon: "avatar.png", email: "private" }]);
    });
    replace(Drop, "find", (filter) => {
      dropFilter = filter;
      return query([{ _id: dropId, title: "Drop", idea: "Idea", ownerId: responderId }]);
    });
  });

  after(() => {
    for (const [model, method, original] of originals.reverse()) model[method] = original;
    if (baseUrl === undefined) delete process.env.S3_BASE_URL;
    else process.env.S3_BASE_URL = baseUrl;
  });

  it("populates sent tap-in drop and responder without changing other fields", async () => {
    const { body } = await supertest(app).get("/activity/sent").expect(200);
    assert.deepEqual(body.data.tapIns[0], {
      _id: String(tapInId),
      requesterId: String(viewerId),
      responderId: { _id: String(responderId), name: "Responder", profileIcon: "https://images.example.com/avatar.png" },
      dropId: { _id: String(dropId), title: "Drop", idea: "Idea" },
      status: "pending",
    });
    assert.equal(body.data.tapIns[1].dropId, null);
    assert.equal(body.data.tapIns[1].responderId, null);
    assert.deepEqual(body.data.connectionRequests[0].recipientId, body.data.tapIns[0].responderId);
    assert.equal(body.meta.tapIns.totalRecords, 2);
    assert.deepEqual(userFilter._id.$in, [String(responderId), String(missingId)]);
    assert.deepEqual(dropFilter._id.$in, [String(dropId), String(missingDropId)]);
  });

  it("only looks up references for the requested page", async () => {
    const { body } = await supertest(app).get("/activity/sent?page=2&limit=1").expect(200);
    assert.equal(body.data.tapIns.length, 1);
    assert.equal(body.data.tapIns[0].responderId, null);
    assert.equal(body.data.tapIns[0].dropId, null);
    assert.equal(body.meta.tapIns.totalRecords, 2);
    assert.deepEqual(userFilter._id.$in, [String(missingId)]);
    assert.deepEqual(dropFilter._id.$in, [String(missingDropId)]);
  });

  it("returns circle invitations sent to invitees", async () => {
    const circleId = new mongoose.Types.ObjectId();
    const requestedCircleId = new mongoose.Types.ObjectId();
    const inviteeId = new mongoose.Types.ObjectId();
    const invitation = {
      _id: new mongoose.Types.ObjectId(),
      circleId,
      userId: inviteeId,
      invitedBy: viewerId,
      status: "invited",
      createdAt: new Date("2026-01-03"),
    };
    const joinRequest = {
      _id: new mongoose.Types.ObjectId(),
      circleId: requestedCircleId,
      userId: viewerId,
      status: "withdrawn",
      createdAt: new Date("2026-01-02"),
    };
    const saved = [];
    const override = (model, method, replacement) => {
      saved.push([model, method, model[method]]);
      model[method] = replacement;
    };
    try {
      override(CircleMember, "distinct", async (_field, filter) =>
        filter.invitedBy === viewerId && filter.status === "invited"
          ? [circleId]
          : filter.userId === viewerId
            ? [requestedCircleId]
            : [],
      );
      override(CircleMember, "find", (filter) =>
        filter.status === "invited"
          ? query([invitation])
          : query([joinRequest]),
      );
      override(CircleMember, "countDocuments", async () => 1);
      override(Circle, "find", (filter) =>
        query(filter._id.$in
          .map((id) => {
            if (String(id) === String(circleId)) return { _id: circleId, name: "Circle" };
            if (String(id) === String(requestedCircleId)) return { _id: requestedCircleId, name: "Requested circle" };
            return null;
          })
          .filter(Boolean)),
      );
      override(Circle, "countDocuments", async () => 1);
      override(User, "find", (filter) =>
        query(filter._id.$in.map((id) =>
          String(id) === String(inviteeId)
            ? { _id: inviteeId, name: "Invitee", profileIcon: "invitee.png" }
            : { _id: id, name: "Other", profileIcon: "" },
        )),
      );

      const { body } = await supertest(app).get("/activity/sent").expect(200);
      assert.deepEqual(body.data.circleInvitations[0], {
        requestId: String(invitation._id),
        circleId: String(circleId),
        circleName: "Circle",
        recipientId: {
          _id: String(inviteeId),
          name: "Invitee",
          profileIcon: "https://images.example.com/invitee.png",
        },
        status: "invited",
        createdAt: invitation.createdAt.toISOString(),
      });
      assert.deepEqual(body.data.circleJoinRequests[0], {
        requestId: String(joinRequest._id),
        circleId: String(requestedCircleId),
        circleName: "Requested circle",
        requesterId: String(viewerId),
        status: "withdrawn",
        createdAt: joinRequest.createdAt.toISOString(),
      });
      assert.equal(body.meta.circleInvitations.totalRecords, 1);
    } finally {
      for (const [model, method, original] of saved.reverse()) model[method] = original;
    }
  });
});
