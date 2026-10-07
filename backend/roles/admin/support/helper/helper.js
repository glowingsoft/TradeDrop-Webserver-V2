const { getFullImageUrl } = require("../../../../helperUtils/imageHelper");

function formatUpdate(Update) {
  if (!Update) return null;

  // Handle both Mongoose doc and plain object
  const cat = Update.toObject ? Update.toObject() : { ...Update };

  // Check if user exists and has an image field
    cat.user.profileIcon = getFullImageUrl(cat.user.profileIcon || "noimage.png");
  // Return the updated object
  return {
    ...cat,
    user: {
      ...cat.user, // Ensure the user object is fully included
      profileIcon: cat.user.profileIcon // Apply the modified profileIcon
    },
  };
}


module.exports = { formatUpdate };