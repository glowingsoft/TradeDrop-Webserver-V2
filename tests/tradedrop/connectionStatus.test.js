const assert = require("node:assert/strict");
const Connection = require("../../backend/models/Connection");
const ConnectionRequest = require("../../backend/models/ConnectionRequest");
const { connectionStatusFor, getConnectionStatuses } = require("../../backend/helperUtils/connectionUtil");

describe("shared connection status", () => {
  const viewer = "viewer";
  const person = "person";

  it("recognizes self without allowing a request", () => {
    const result = connectionStatusFor(viewer, viewer, null, null);
    assert.equal(result.connectionStatus, "self");
    assert.equal(result.canSendConnectionRequest, false);
  });

  it("prioritizes an active connection over a pending request", () => {
    const result = connectionStatusFor(viewer, person, { _id: "connection", status: "active" }, {
      _id: "request",
      status: "pending",
      requesterId: viewer,
    });
    assert.equal(result.connectionStatus, "connected");
    assert.equal(result.connectionId, "connection");
    assert.equal(result.requestId, null);
    assert.equal(result.requestSent, false);
  });

  it("distinguishes pending request directions and cooldown", () => {
    const outgoing = connectionStatusFor(viewer, person, null, {
      _id: "request",
      status: "pending",
      requesterId: viewer,
      recipientId: person,
    });
    assert.equal(outgoing.connectionStatus, "request_sent");
    assert.equal(outgoing.requestId, "request");
    assert.equal(outgoing.connectionId, null);
    const incoming = connectionStatusFor(viewer, person, null, {
      status: "pending",
      requesterId: person,
      recipientId: viewer,
    });
    assert.equal(incoming.connectionStatus, "incoming_request");
    assert.equal(incoming.canSendConnectionRequest, false);
    const declined = connectionStatusFor(viewer, person, null, {
      status: "declined",
      cooldownUntil: new Date(Date.now() + 60000),
    });
    assert.equal(declined.canSendConnectionRequest, false);
    assert.equal(connectionStatusFor(viewer, person, null, null).canSendConnectionRequest, true);
  });

  it("fetches a batch once and assigns the latest request for each pair", async () => {
    const originalConnections = Connection.find;
    const originalRequests = ConnectionRequest.find;
    const connectedPair = Connection.pairKeyFor(viewer, "connected");
    const requestedPair = Connection.pairKeyFor(viewer, "requested");
    let queries = 0;
    try {
      Connection.find = (filter) => {
        queries += 1;
        assert.deepEqual(filter.pairKey.$in, [connectedPair, requestedPair]);
        return { lean: async () => [{ _id: "connection", pairKey: connectedPair, status: "active" }] };
      };
      ConnectionRequest.find = (filter) => {
        queries += 1;
        assert.deepEqual(filter.pairKey.$in, [connectedPair, requestedPair]);
        return {
          sort: (sort) => {
            assert.deepEqual(sort, { createdAt: -1, _id: -1 });
            return { lean: async () => [
              { _id: "latest", pairKey: requestedPair, status: "pending", requesterId: viewer },
              { _id: "older", pairKey: requestedPair, status: "declined" },
            ] };
          },
        };
      };
      const statuses = await getConnectionStatuses(viewer, ["connected", "requested", viewer, "connected"]);
      assert.equal(queries, 2);
      assert.equal(statuses.get("connected").connectionId, "connection");
      assert.equal(statuses.get("requested").requestId, "latest");
      assert.equal(statuses.get(viewer).connectionStatus, "self");
    } finally {
      Connection.find = originalConnections;
      ConnectionRequest.find = originalRequests;
    }
  });
});
