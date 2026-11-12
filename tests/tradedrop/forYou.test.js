const assert = require("node:assert/strict");

require("../helpers/registerAliases");

const circleService = require("../../backend/roles/user/circles/service");
const eventService = require("../../backend/roles/user/events/service");
const radarService = require("../../backend/roles/user/radar/radarService");
const discoveryPath = require.resolve("../../backend/roles/user/discovery/service");
const originals = {
  listCircles: circleService.listCircles,
  listEvents: eventService.listEvents,
  excludedUserIds: radarService.excludedUserIds,
  listRadarPeople: radarService.listRadarPeople,
};

circleService.listCircles = async () => ({ data: [], meta: {} });
eventService.listEvents = async () => ({ data: [], meta: {} });
radarService.excludedUserIds = async () => [];
radarService.listRadarPeople = async (req) => ({
  data: [{ _id: "person", connectionStatus: "not_connected", canSendConnectionRequest: true }],
  meta: { query: { ...req.query } },
});
delete require.cache[discoveryPath];
const { forYou } = require(discoveryPath);

describe("for-you people discovery", () => {
  after(() => {
    circleService.listCircles = originals.listCircles;
    eventService.listEvents = originals.listEvents;
    radarService.excludedUserIds = originals.excludedUserIds;
    radarService.listRadarPeople = originals.listRadarPeople;
    delete require.cache[discoveryPath];
  });

  it("returns nearby people with connection status instead of nearby Drops", async () => {
    const result = await forYou({
      user: { _id: "viewer" },
      query: { lat: "40.7", lng: "-74", page: "2" },
    });

    assert.deepEqual(result.nearbyPeople.data, [
      { _id: "person", connectionStatus: "not_connected", canSendConnectionRequest: true },
    ]);
    assert.deepEqual(result.nearbyPeople.meta.query, { lat: "40.7", lng: "-74", page: "2" });
    assert.equal("nearbyDrops" in result, false);
  });

  it("supports searching anywhere without passing location coordinates to people discovery", async () => {
    const result = await forYou({
      user: { _id: "viewer" },
      query: { lat: "40.7", lng: "-74", anywhere: "true" },
    });

    assert.deepEqual(result.nearbyPeople.meta.query, { anywhere: "true" });
  });
});
