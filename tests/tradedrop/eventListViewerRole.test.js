const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const CircleMember = require("../../backend/models/CircleMember");
const Event = require("../../backend/models/Event");
const { listEvents } = require("../../backend/roles/user/events/service");

describe("Event list viewer roles", () => {
  const viewerId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();
  const circles = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());
  const originals = { find: CircleMember.find, aggregate: Event.aggregate };
  let memberships;
  let membershipFilter;
  let pipeline;

  beforeEach(() => {
    memberships = [
      { circleId: circles[0], userId: viewerId, status: "active", role: "organizer" },
      { circleId: circles[1], userId: viewerId, status: "active", role: "member" },
      { circleId: circles[2], userId: viewerId, status: "pending", role: "member" },
      { circleId: circles[3], userId: otherId, status: "active", role: "organizer" },
    ];
    membershipFilter = null;
    CircleMember.find = (filter) => {
      membershipFilter = filter;
      return {
        select: () => ({
          lean: async () => memberships.filter((member) =>
            String(member.userId) === String(filter.userId) && member.status === filter.status),
        }),
      };
    };
    Event.aggregate = async (value) => {
      pipeline = value;
      return [{
        items: circles.map((circleId) => ({
          _id: new mongoose.Types.ObjectId(),
          circleId,
          creatorId: otherId,
          name: "Event",
          audience: "public",
          status: "published",
          rsvps: [],
        })),
        total: [{ count: 4 }],
      }];
    };
  });

  after(() => {
    CircleMember.find = originals.find;
    Event.aggregate = originals.aggregate;
  });

  it("labels each event using active membership in its own circle", async () => {
    const result = await listEvents({ user: { _id: viewerId }, query: {} });
    assert.deepEqual(result.data.map((event) => event.viewerRole), ["organizer", "member", "none", "none"]);
    assert.equal(String(membershipFilter.userId), String(viewerId));
    assert.equal(membershipFilter.status, "active");
    const visibility = pipeline.find((stage) => stage.$match?.$or?.some((part) => part.circleId?.$in)).$match;
    assert.deepEqual(visibility.$or[1].circleId.$in.map(String), [String(circles[0]), String(circles[1])]);
    assert.equal(result.meta.totalRecords, 4);
  });

  it("returns none for anonymous viewers without fetching memberships", async () => {
    const result = await listEvents({ query: {} });
    assert.deepEqual(result.data.map((event) => event.viewerRole), ["none", "none", "none", "none"]);
    assert.equal(membershipFilter, null);
    const visibility = pipeline.find((stage) => stage.$match?.audience === "public").$match;
    assert.deepEqual(visibility["circle.privacy"].$in, ["open", "approval"]);
  });

  it("propagates membership lookup errors", async () => {
    CircleMember.find = () => ({ select: () => ({ lean: async () => { throw new Error("database failure"); } }) });
    await assert.rejects(listEvents({ user: { _id: viewerId }, query: {} }), /database failure/);
  });
});
