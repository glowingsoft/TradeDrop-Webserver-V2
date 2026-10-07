const { popBufferBatch } = require("@redisCache");
const EngagementEvents = require("@EngagementEventsModel");
const { logger } = require("../../logging");

const BATCH_SIZE = 2000;

const getDedupeFilter = (event) => {
  // hourly dedupe for logged-in users
  if (event.userId && event.dedupeHourBucket) {
    return {
      userId: event.userId,
      entityType: event.entityType,
      entityId: event.entityId,
      eventType: event.eventType,
      dedupeHourBucket: new Date(event.dedupeHourBucket),
    };
  }

  // unique save per user
  if (event.eventType === "profile_save" && event.userId) {
    return {
      userId: event.userId,
      entityType: event.entityType,
      entityId: event.entityId,
      eventType: event.eventType,
    };
  }

  // fallback: anonymous/non-deduped event should insert normally
  return null;
};

const flushEngagementBuffer = async () => {
  let totalInserted = 0;
  let totalSkippedDuplicates = 0;

  while (true) {
    const batch = await popBufferBatch("engagement", BATCH_SIZE);
    if (!batch.length) break;

    const operations = batch.map((event) => {
      const filter = getDedupeFilter(event);

      if (!filter) {
        return {
          insertOne: {
            document: event,
          },
        };
      }

      return {
        updateOne: {
          filter,
          update: {
            $setOnInsert: event,
          },
          upsert: true,
        },
      };
    });

    const result = await EngagementEvents.bulkWrite(operations, {
      ordered: false,
    });

    totalInserted += result.insertedCount + result.upsertedCount;

    const skipped =
      operations.length -
      result.insertedCount -
      result.upsertedCount -
      result.modifiedCount -
      result.matchedCount;

    totalSkippedDuplicates += Math.max(skipped, 0);

    if (totalInserted > 50000) break;
  }

  if (totalInserted > 0) {
    console.log(`📊 Flushed ${totalInserted} engagement events`);
  }

  if (totalSkippedDuplicates > 0) {
    logger.info(
      `Engagement flush skipped ${totalSkippedDuplicates} duplicate events`
    );
  }
};

module.exports = { flushEngagementBuffer };