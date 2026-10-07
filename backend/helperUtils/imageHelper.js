function getFullImageUrl(imagePath, baseUrl = process.env.S3_BASE_URL || "") {
  if (imagePath && !imagePath.startsWith("http")) {
    return baseUrl + imagePath;
  }
  if (imagePath && ["noimage.png", "noimg.png", "no-image.png"].includes(imagePath)) {
    return baseUrl + "T-D";
  }
  return imagePath || baseUrl + "noimage.png";
}

module.exports = { getFullImageUrl };
