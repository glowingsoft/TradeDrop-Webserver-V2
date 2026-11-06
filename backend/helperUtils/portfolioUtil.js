const { getFullImageUrl } = require("./imageHelper");

const MAX_PORTFOLIO_IMAGES = 6;

function portfolioImageUrls(item) {
  if (Array.isArray(item.imageUrls) && item.imageUrls.length) return item.imageUrls;
  return item.imageUrl ? [item.imageUrl] : [];
}

function portfolioItemView(item, { fullUrls = false } = {}) {
  const imageUrls = portfolioImageUrls(item).map((url) => (fullUrls ? getFullImageUrl(url) : url));
  const { imageUrl, tags, ...rest } = item;
  return { ...rest, imageUrls };
}

module.exports = { MAX_PORTFOLIO_IMAGES, portfolioImageUrls, portfolioItemView };
