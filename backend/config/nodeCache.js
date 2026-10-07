const NodeCache = require("node-cache");
// Initialize node-cache with no TTL (items persist until manually deleted)
const nodeCache = new NodeCache({ stdTTL: 0, checkperiod: 0 });

// Initialize a specific cache for user data with a TTL (e.g., 1 hour)
// stdTTL: 3600 means each cached user is valid for 1 hour.
// checkperiod: 600 means expired data is removed every 10 minutes.
const userCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// Export the nodeCache and userCache instances
module.exports = { nodeCache, userCache };
