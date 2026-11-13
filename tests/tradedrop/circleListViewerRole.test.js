const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const Circle = require("../../backend/models/Circle");
const CircleMember = require("../../backend/models/CircleMember");
const { listCircles } = require("../../backend/roles/user/circles/service");

describe("Circle discovery viewer roles", () => {
  const viewerId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();
  const ids = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());
  const originals = { aggregate: Circle.aggregate, find: CircleMember.find };
  let circles;
  let memberships;
  let membershipFilter;
  let pipeline;

  beforeEach(() => {
    circles = ids.map((_id) => ({
      _id,
      creatorId: otherId,
      name: "Circle",
      purpose: "Purpose",
      category: new mongoose.Types.ObjectId(),
      privacy: "open",
    }));
    memberships = [
      { circleId: ids[0], userId: viewerId, status: "active", role: "organizer" },
      { circleId: ids[1], userId: viewerId, status: "active", role: "member" },
      { circleId: ids[2], userId: viewerId, status: "pending", role: "member" },
      { circleId: ids[3], userId: otherId, status: "active", role: "organizer" },
    ];
    membershipFilter = null;
    Circle.aggregate = async (value) => {
      pipeline = value;
      return [{ items: circles, total: [{ count: 8 }] }];
    };
    CircleMember.find = (filter) => {
      membershipFilter = filter;
      return {
        select: () => ({
          lean: async () => memberships.filter((member) =>
            String(member.userId) === String(filter.userId) &&
            member.status === filter.status &&
            filter.circleId.$in.some((id) => String(id) === String(member.circleId))),
        }),
      };
    };
  });

  after(() => {
    Circle.aggregate = originals.aggregate;
    CircleMember.find = originals.find;
  });

  it("labels the current viewer's active role for each paginated circle", async () => {
    const result = await listCircles({ user: { _id: viewerId }, query: { page: "2", limit: "4" } });
    assert.deepEqual(result.data.map((circle) => circle.viewerRole), ["organizer", "member", "none", "none"]);
    assert.equal(String(membershipFilter.userId), String(viewerId));
    assert.equal(membershipFilter.status, "active");
    assert.deepEqual(membershipFilter.circleId.$in.map(String), ids.map(String));
    assert.deepEqual(pipeline.find((stage) => stage.$facet).$facet.items, [{ $skip: 4 }, { $limit: 4 }]);
    assert.equal(result.meta.totalRecords, 8);
  });

  it("returns none for anonymous viewers and avoids a membership query on empty pages", async () => {
    const anonymous = await listCircles({ query: {} });
    assert.deepEqual(anonymous.data.map((circle) => circle.viewerRole), ["none", "none", "none", "none"]);
    assert.equal(membershipFilter, null);
    circles = [];
    const empty = await listCircles({ user: { _id: viewerId }, query: {} });
    assert.deepEqual(empty.data, []);
    assert.equal(membershipFilter, null);
  });

  it("propagates membership lookup errors", async () => {
    CircleMember.find = () => ({ select: () => ({ lean: async () => { throw new Error("database failure"); } }) });
    await assert.rejects(listCircles({ user: { _id: viewerId }, query: {} }), /database failure/);
  });
});
