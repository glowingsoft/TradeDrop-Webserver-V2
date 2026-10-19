const isDev = process.env.NODE_ENV === "dev" || process.env.NODE_ENV === "mobileapps";
const localRegex = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const PROD_ORIGINS = [
  "https://tradedrop.com",
  "https://www.tradedrop.com",
  "https://dev.tradedrop.com",
  "https://www.dev.tradedrop.com",
  "http://localhost:4003",
  "http://localhost:3030",
  "https://tradedrop.vercel.app",
  "http://54.226.24.240/",
  localRegex,
];

module.exports = {
  isDev,
  allowedOrigins: isDev ? [] : PROD_ORIGINS,
  connectSrc: isDev ? ["*"] : ["'self'", ...PROD_ORIGINS],
};
