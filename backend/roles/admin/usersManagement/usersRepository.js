// repositories/userRepository.js

const { User } = require("@UsersModel");

// Create
const createUser = async (data) => {
  const user = new User(data);
  return await user.save();
};

// Get all with filters
const getUsersWithFilters = async (query, skip, limit) => {
  const users = await User.aggregate([
    { $match: query },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    ...(limit > 0 ? [{ $limit: limit }] : []),
  ]);

  return users;
};

// Count by condition
const countUsers = async (query = {}) => {
  return User.countDocuments(query);
};

// Find by ID with optional projection and populate suppliers and category
const findUserById = async (id, projection = null) => {
  // Prepare projection object if needed
  const proj = projection ? projection : {};

  // Find user and populate suppliers and category in companyDetails
  return User.findById(id, proj);
};

const getUserDetailsForQRRepo = async (id) => {
  return User.findById(id).select("profileIcon name email phoneNumber");
};

// Update and save
const updateUserData = async (user, data) => {
  Object.assign(user, data);
  return await user.save();
};

// Delete
const deleteUserById = async (user) => {
  return await user.deleteOne();
};

//findByIdAndUpdate
const findByIdAndUpdate = async (id, data) => {
  return User.findByIdAndUpdate(id, data, { new: true });
};

/**
 * Update user's 2FA secret and status
 */
const updateTwoFA = async (userId, data) => {
  return User.findByIdAndUpdate(
    userId,
    { $set: data },
    {
      new: true,
      runValidators: true,
    },
  );
};
const getDistinctAreaLabels = async () => {
  const result = await User.distinct("areaLabel", {
    "accountState.userType": "user",
    "accountState.status": "active",
    areaLabel: { $nin: [null, ""] },
  });
  return result?.map((v) => ({ label: v, value: v }));
};

module.exports = {
  createUser,
  getUsersWithFilters,
  countUsers,
  findUserById,
  updateUserData,
  deleteUserById,
  findByIdAndUpdate,
  updateTwoFA,
  getUserDetailsForQRRepo,
  getDistinctAreaLabels,
};
