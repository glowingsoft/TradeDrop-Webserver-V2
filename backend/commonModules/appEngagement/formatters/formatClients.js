const { getFullImageUrl } = require("@helperUtils/imageHelper");

const formatClient = (client) => ({
  ...client,

  user: {
    ...client.user,
    profileIcon: getFullImageUrl(client.user.profileIcon),
  },
});

const formatClients = (clients = []) => {
  return clients.map(formatClient);
};

module.exports = {
  formatClient,
  formatClients,
};
