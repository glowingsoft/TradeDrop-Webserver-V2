const { getFullImageUrl } = require("../../../../helperUtils/imageHelper");

function formatFavoritesOrganization(item) {
  let org = item;
  if (!org) return null;

  // Remove unnecessary fields
  delete org.__v;

  // Handle media transformation for aggregation structure
  if (org.image) {
    const imageName = org.image;
    org.image = getFullImageUrl(imageName);  // Update the image URL
  }

  // Return the modified org object
  return org; 
}

module.exports = {
  formatFavoritesOrganization,
};