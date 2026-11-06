const cron = require("node-cron");
const { acquireLock, releaseLock } = require("@redisCache");
const { expireDrops } = require("@backend/roles/user/drops/service");

const startCrons = () => {
  cron.schedule("0 */1 * * *", async () => {
    const lockKey = "cron:engagement-buffer-flush";
    const lock = await acquireLock(lockKey, 120);

    if (!lock) return;

    try {
    } catch (err) {
      console.error("❌ Engagement flush cron failed:", err);
    } finally {
      await releaseLock(lockKey, lock);
    }
  });

  cron.schedule("*/5 * * * *", async () => {
    const lockKey = "cron:drop-expiry";
    const lock = await acquireLock(lockKey, 240);
    if (!lock) return;
    try {
      await expireDrops();
    } catch (err) {
      console.error("Drop expiry cron failed:", err);
    } finally {
      await releaseLock(lockKey, lock);
    }
  });
};

module.exports = { startCrons };
