const cron = require("node-cron");
const { acquireLock, releaseLock } = require("@redisCache");

const startCrons = () => {
  // cron.schedule("*/5 * * * * *", async () => { //5 seconds for testing
  cron.schedule("0 */1 * * *", async () => {
    //every 1 hour
    //every 1 hour
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
};

module.exports = { startCrons };
