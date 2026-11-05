/**
 * Moves Circle.members (embedded) into the CircleMember collection, then removes the embedded field.
 * Idempotent: safe to re-run. Usage: npm run migrate:circle-members
 */
require("dotenv").config();
const mongoose = require("mongoose");

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
const BATCH = 500;

async function run() {
  if (!uri) throw new Error("Set MONGO_URI (or MONGODB_URI / MONGO_URL)");
  await mongoose.connect(uri);
  const CircleMember = require("../models/CircleMember");
  const circles = mongoose.connection.db.collection("circles");
  let migrated = 0;
  const cursor = circles.find({ members: { $exists: true } }, { projection: { members: 1, createdAt: 1 } });
  for await (const circle of cursor) {
    const operations = (circle.members || []).map((member) => ({
      updateOne: {
        filter: { circleId: circle._id, userId: member.userId },
        update: {
          $setOnInsert: {
            role: member.role || "member",
            status: member.status || "active",
            invitedBy: member.invitedBy || null,
            joinedAt: member.joinedAt || null,
            createdAt: member.joinedAt || circle.createdAt || new Date(),
            updatedAt: member.updatedAt || new Date(),
          },
        },
        upsert: true,
      },
    }));
    for (let i = 0; i < operations.length; i += BATCH) {
      await CircleMember.collection.bulkWrite(operations.slice(i, i + BATCH), { ordered: false });
    }
    await circles.updateOne({ _id: circle._id }, { $unset: { members: "" } });
    migrated += operations.length;
  }
  await CircleMember.syncIndexes();
  await mongoose.model("Circle").syncIndexes();
  console.log(`Migrated ${migrated} Circle members`);
}

if (require.main === module) {
  require("../models/Circle");
  run()
    .then(() => mongoose.disconnect())
    .catch(async (err) => {
      console.error("Circle member migration failed:", err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { run };
