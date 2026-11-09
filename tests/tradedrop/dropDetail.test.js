const assert = require("node:assert/strict");
const path = require("node:path");
const moduleAlias = require("module-alias");
const mongoose = require("mongoose");

for (const [alias, target] of Object.entries(require("../../aliasConfig/pathAliases.config"))) {
  moduleAlias.addAlias(alias, path.resolve(__dirname, "../..", target));
}

const { Drop } = require("../../backend/models/Drop");
const Trade = require("../../backend/models/Trade");
const TapIn = require("../../backend/models/TapIn");
const { getDrop } = require("../../backend/roles/user/drops/service");

describe("drop detail mutual collaborations", () => {
  const dropId = new mongoose.Types.ObjectId();
  const ownerId = new mongoose.Types.ObjectId();
  const viewerId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();
  const original = {};
  let drop;
  let countFilter;
  let countCalls;
  let tapIn;
  let tapInFilter;
  let tapInSort;
  let tapInCalls;

  before(() => {
    original.findDrop = Drop.findOne;
    original.findTrade = Trade.findOne;
    original.countTrades = Trade.countDocuments;
    original.findTapIn = TapIn.findOne;
  });

  beforeEach(() => {
    drop = { _id: dropId, ownerId, status: "open", visibility: "public", referenceImages: [] };
    countCalls = 0;
    countFilter = null;
    tapIn = null;
    tapInFilter = null;
    tapInSort = null;
    tapInCalls = 0;
    Drop.findOne = () => ({ populate: () => ({ lean: async () => drop }) });
    Trade.findOne = () => ({ select: () => ({ lean: async () => ({ status: "active" }) }) });
    TapIn.findOne = (filter) => {
      tapInCalls += 1;
      tapInFilter = filter;
      return {
        sort: (sort) => {
          tapInSort = sort;
          return { select: () => ({ lean: async () => tapIn }) };
        },
      };
    };
    Trade.countDocuments = async (filter) => {
      countCalls += 1;
      countFilter = filter;
      return 2;
    };
  });

  after(() => {
    Drop.findOne = original.findDrop;
    Trade.findOne = original.findTrade;
    Trade.countDocuments = original.countTrades;
    TapIn.findOne = original.findTapIn;
  });

  it("counts active and completed collaborations in both directions with the owner", async () => {
    const result = await getDrop(dropId, viewerId);
    assert.equal(result.mutualCollaborationCount, 2);
    assert.equal(result._id, String(dropId));
    assert.equal(result.ownerId, String(ownerId));
    assert.equal(countCalls, 1);
    assert.deepEqual(countFilter, {
      kind: "collaboration",
      status: { $in: ["active", "completed"] },
      $or: [
        { requesterId: viewerId, responderId: ownerId },
        { requesterId: ownerId, responderId: viewerId },
      ],
    });
  });

  it("returns zero without querying for anonymous viewers and the owner", async () => {
    const anonymousResult = await getDrop(dropId);
    assert.equal(anonymousResult.mutualCollaborationCount, 0);
    assert.equal(anonymousResult.isTappedIn, false);
    assert.equal(anonymousResult.myTapIn, null);
    assert.equal(tapInCalls, 0);
    const ownerResult = await getDrop(dropId, ownerId);
    assert.equal(ownerResult.mutualCollaborationCount, 0);
    assert.equal(ownerResult.yours, true);
    assert.equal(countCalls, 0);
  });

  it("returns the latest Tap In status for the current requester", async () => {
    for (const status of ["pending", "accepted", "closed"]) {
      tapIn = { _id: new mongoose.Types.ObjectId(), status, notes: "Hello", deletedAt: null };
      const result = await getDrop(dropId, viewerId);
      assert.equal(result.isTappedIn, true);
      assert.deepEqual(result.myTapIn, tapIn);
    }
    assert.deepEqual(tapInFilter, { dropId, requesterId: viewerId });
    assert.deepEqual(tapInSort, { createdAt: -1, _id: -1 });
  });

  it("hides withdrawn, declined or nonexistent latest Tap Ins", async () => {
    for (const latest of [
      { status: "pending", deletedAt: new Date() },
      { status: "closed", deletedAt: new Date() },
      { status: "declined", deletedAt: null },
      null,
    ]) {
      tapIn = latest;
      const result = await getDrop(dropId, viewerId);
      assert.equal(result.isTappedIn, false);
      assert.equal(result.myTapIn, null);
    }
  });

  it("returns the new pending Tap In after a withdrawal or decline", async () => {
    for (const previous of [
      { status: "closed", deletedAt: new Date() },
      { status: "declined", deletedAt: null },
    ]) {
      tapIn = previous;
      assert.equal((await getDrop(dropId, viewerId)).myTapIn, null);
      tapIn = { _id: new mongoose.Types.ObjectId(), status: "pending", notes: "Retry", deletedAt: null };
      const result = await getDrop(dropId, viewerId);
      assert.equal(result.isTappedIn, true);
      assert.deepEqual(result.myTapIn, tapIn);
    }
  });

  it("limits the duplicate-request index to non-withdrawn pending Tap Ins", () => {
    const index = TapIn.schema.indexes().find(([fields]) => fields.requesterId === 1 && fields.dropId === 1);
    assert.ok(index);
    assert.equal(index[1].unique, true);
    assert.deepEqual(index[1].partialFilterExpression, { status: "pending", deletedAt: { $type: "null" } });
  });

  it("does not query collaborations for inaccessible drops", async () => {
    drop.visibility = "direct";
    drop.targetUserId = otherId;
    await assert.rejects(getDrop(dropId, viewerId), { statusCode: 404 });
    assert.equal(countCalls, 0);
    assert.equal(tapInCalls, 0);
    drop.visibility = "public";
    drop.status = "draft";
    await assert.rejects(getDrop(dropId, viewerId), { statusCode: 404 });
    assert.equal(countCalls, 0);
    assert.equal(tapInCalls, 0);
  });

  it("propagates count query failures", async () => {
    Trade.countDocuments = async () => { throw new Error("count failed"); };
    await assert.rejects(getDrop(dropId, viewerId), { message: "count failed" });
  });

  it("propagates Tap In query failures", async () => {
    TapIn.findOne = () => ({
      sort: () => ({ select: () => ({ lean: async () => { throw new Error("Tap In query failed"); } }) }),
    });
    await assert.rejects(getDrop(dropId, viewerId), { message: "Tap In query failed" });
  });
});
