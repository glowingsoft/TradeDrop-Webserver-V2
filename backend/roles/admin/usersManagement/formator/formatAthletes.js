const { getFullImageUrl } = require("@helperUtils/imageHelper");


const formatAthlete = (athlete) => ({
  ...athlete,
  profileIcon: getFullImageUrl(athlete.profileIcon || "noimage.png"),
});

const formatAthletes = (athletes = []) => {
  return athletes.map(formatAthlete);
};

module.exports = {
  formatAthlete,
  formatAthletes,
};
