// convertToMongoArray.js

const mongoose = require('mongoose');

/**
 * Converts a comma-separated string of IDs into an array of MongoDB ObjectIds
 * @param {string} idsString - A comma-separated string of IDs.
 * @returns {Promise} - A promise resolving to an array of MongoDB ObjectIds.
 */
const convertToMongoArray = async (idsString) => {

  // Split the string by commas or '%' and trim spaces
  const idsArray = idsString.split(/,|\%/).map(id => id.trim());

  // Convert each ID string to MongoDB ObjectId and return as an array
  return idsArray.map(id => new mongoose.Types.ObjectId(id));
};

module.exports = convertToMongoArray;