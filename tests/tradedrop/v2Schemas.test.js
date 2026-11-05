const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { Drop } = require("../../backend/models/Drop");
const Circle = require("../../backend/models/Circle");
const CircleMember = require("../../backend/models/CircleMember");
const Event = require("../../backend/models/Event");
const { Dispute } = require("../../backend/models/Dispute");
const UserReport = require("../../backend/models/UserReport");
const { User } = require("../../backend/models/UserModel");

const objectId = () => new mongoose.Types.ObjectId();

describe("V2 model validation", () => {
  it("allows incomplete new Drops only as drafts", async () => {
    await new Drop({ ownerId: objectId() }).validate();
    await assert.rejects(new Drop({ ownerId: objectId(), status: "open" }).validate());
  });

  it("requires a meeting location for in-person Drops but permits remote Drop fields", async () => {
    const fields = {
      ownerId: objectId(),
      title: "Photo shoot",
      needText: "A model",
      offerText: "Portraits",
      needCategoryId: objectId(),
      offerCategoryId: objectId(),
      timingChip: objectId(),
    };
    await assert.rejects(new Drop({ ...fields, status: "open", type: "in_person" }).validate());
    await new Drop({ ...fields, status: "open", type: "remote" }).validate();
  });

  it("enforces dispute descriptions, outcomes, and evidence limits", async () => {
    const fields = {
      tradeId: objectId(),
      raisedBy: objectId(),
      against: objectId(),
      reason: "work_not_delivered",
      desiredOutcome: "finish_agreed_work",
      description: "This description is at least twenty characters.",
    };
    await new Dispute(fields).validate();
    await assert.rejects(new Dispute({ ...fields, description: "Too short" }).validate());
    await assert.rejects(new Dispute({ ...fields, evidence: ["a", "b", "c", "d"] }).validate());
  });

  it("validates Circle roles, RSVP states, and report status enums", async () => {
    const circle = new Circle({
      creatorId: objectId(),
      name: "Circle",
      purpose: "Shared creative work",
      category: objectId(),
      polls: [
        {
          question: "First poll?",
          options: ["Yes", "No"],
          createdBy: objectId(),
          closesAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        },
        {
          question: "Second poll?",
          options: ["Yes", "No"],
          createdBy: objectId(),
          closesAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        },
      ],
    });
    await circle.validate();
    assert.equal(circle.polls.length, 2);
    assert.ok(circle.polls.every((poll) => poll._id));
    await new CircleMember({
      circleId: objectId(),
      userId: objectId(),
      role: "organizer",
      status: "active",
    }).validate();
    await assert.rejects(
      new CircleMember({ circleId: objectId(), userId: objectId(), status: "unknown" }).validate(),
    );
    await new Event({
      circleId: objectId(),
      creatorId: objectId(),
      name: "Photo walk",
      rsvps: [{ userId: objectId(), status: "waitlist" }],
    }).validate();
    await assert.rejects(
      new UserReport({
        reporterId: objectId(),
        reportedUserId: objectId(),
        reason: "spam",
        status: "unknown",
      }).validate(),
    );
  });

  it("stores one image URL per portfolio item", () => {
    const user = new User({
      email: "portfolio@example.com",
      timezone: "UTC",
      portfolioItems: [{ imageUrl: "cover.jpg", photos: ["other.jpg"] }],
    });
    const item = user.toObject().portfolioItems[0];
    assert.equal(item.imageUrl, "cover.jpg");
    assert.equal(Object.prototype.hasOwnProperty.call(item, "photos"), false);
  });
});
