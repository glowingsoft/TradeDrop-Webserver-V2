const assert = require("node:assert/strict");
const path = require("node:path");
const moduleAlias = require("module-alias");
const mongoose = require("mongoose");

for (const [alias, target] of Object.entries(require("../../aliasConfig/pathAliases.config"))) {
  moduleAlias.addAlias(alias, path.resolve(__dirname, "../..", target));
}

const { Drop } = require("../../backend/models/Drop");
const Trade = require("../../backend/models/Trade");
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

  before(() => {
    original.findDrop = Drop.findOne;
    original.findTrade = Trade.findOne;
    original.countTrades = Trade.countDocuments;
  });

  beforeEach(() => {
    drop = { _id: dropId, ownerId, status: "open", visibility: "public", referenceImages: [] };
    countCalls = 0;
    countFilter = null;
    Drop.findOne = () => ({ populate: () => ({ lean: async () => drop }) });
    Trade.findOne = () => ({ select: () => ({ lean: async () => ({ status: "active" }) }) });
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
    assert.equal((await getDrop(dropId)).mutualCollaborationCount, 0);
    const ownerResult = await getDrop(dropId, ownerId);
    assert.equal(ownerResult.mutualCollaborationCount, 0);
    assert.equal(ownerResult.yours, true);
    assert.equal(countCalls, 0);
  });

  it("does not query collaborations for inaccessible drops", async () => {
    drop.visibility = "direct";
    drop.targetUserId = otherId;
    await assert.rejects(getDrop(dropId, viewerId), { statusCode: 404 });
    assert.equal(countCalls, 0);
    drop.visibility = "public";
    drop.status = "draft";
    await assert.rejects(getDrop(dropId, viewerId), { statusCode: 404 });
    assert.equal(countCalls, 0);
  });

  it("propagates count query failures", async () => {
    Trade.countDocuments = async () => { throw new Error("count failed"); };
    await assert.rejects(getDrop(dropId, viewerId), { message: "count failed" });
  });
});
