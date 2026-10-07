const { Activity, ACTIVITY_ACTIONS, ACTIVITY_TYPES } = require("../models/Activity");

const createActivity = async ({ type, user = null, drop = null, eventKey }) => {
  if (!ACTIVITY_ACTIONS[type]) {
    throw new Error(`Invalid activity type: ${type}`);
  }

  return Activity.create({
    type,
    action: ACTIVITY_ACTIONS[type],
    user: user?._id || user,
    drop: drop?._id || drop,
    eventKey: eventKey ? eventKey : `${type}:${drop?._id || user?._id}`,
  });
};
module.exports = {
  createActivity,
  activityTypes: ACTIVITY_TYPES,
};
