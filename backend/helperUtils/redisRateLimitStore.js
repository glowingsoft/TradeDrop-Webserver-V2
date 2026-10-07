const { getRedisClient } = require("../config/redis/redisConfig");

class RedisRateLimitStore {
  constructor(options = {}) {
    this.client = options.client || getRedisClient();
    this.prefix = options.prefix || "rate-limit";
    this.windowMs = options.windowMs || 60 * 1000;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  buildKey(key) {
    return `${this.prefix}:${key}`;
  }

  buildResetTime(ttlMs) {
    if (!ttlMs || ttlMs < 0) {
      return new Date(Date.now() + this.windowMs);
    }

    return new Date(Date.now() + ttlMs);
  }

  async get(key) {
    const redisKey = this.buildKey(key);
    const [hits, ttlMs] = await Promise.all([
      this.client.get(redisKey),
      this.client.pttl(redisKey),
    ]);

    if (hits === null) {
      return undefined;
    }

    return {
      totalHits: Number(hits),
      resetTime: this.buildResetTime(Number(ttlMs)),
    };
  }

  async increment(key) {
    const redisKey = this.buildKey(key);
    const [totalHits, ttlMs] = await this.client.eval(
      `
        local current = redis.call("INCR", KEYS[1])
        local ttl = redis.call("PTTL", KEYS[1])

        if ttl < 0 then
          redis.call("PEXPIRE", KEYS[1], ARGV[1])
          ttl = tonumber(ARGV[1])
        end

        return {current, ttl}
      `,
      1,
      redisKey,
      this.windowMs
    );

    return {
      totalHits: Number(totalHits),
      resetTime: this.buildResetTime(Number(ttlMs)),
    };
  }

  async decrement(key) {
    const redisKey = this.buildKey(key);
    const totalHits = await this.client.decr(redisKey);

    if (Number(totalHits) <= 0) {
      await this.client.del(redisKey);
    }
  }

  async resetKey(key) {
    await this.client.del(this.buildKey(key));
  }

  async resetAll() {
    const stream = this.client.scanStream({
      match: `${this.prefix}:*`,
      count: 200,
    });

    await new Promise((resolve, reject) => {
      const pendingDeletes = [];

      stream.on("data", (keys) => {
        if (!keys.length) {
          return;
        }

        const pipeline = this.client.pipeline();
        keys.forEach((key) => pipeline.del(key));
        pendingDeletes.push(pipeline.exec());
      });

      stream.on("end", async () => {
        try {
          await Promise.all(pendingDeletes);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      stream.on("error", reject);
    });
  }

  shutdown() {}
}

module.exports = RedisRateLimitStore;
