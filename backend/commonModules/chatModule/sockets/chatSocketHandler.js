const mongoose = require('mongoose');

const { getUserRoom, resolveConversationRoom } = require("./chatSocketRooms");
const { markUserOnline, markUserOffline } = require("./chatPresenceRedis");
const {
  loadAndCacheConversationPeers,
  emitStatusToConversationPeers,
  clearConversationPeers,
} = require("./chatPresenceEmitter");
const { User } = require('../../../models/UserModel');
const { sendUserNotifications } = require('../../../controllers/communicationController');
const { getFullImageUrl } = require('../../../helperUtils/imageHelper');

const activeCallMap = new Map(); // userId -> partnerId (bidirectional call lock)

const chatSocketHandler = (io) => {
  io.on("connection", async (socket) => {
    let { subjectId, objectId, type } = socket.handshake.query;

    const { Types } = mongoose;

    if (!objectId) {
      console.log("Single User Socket Connect->", subjectId);
      if (!subjectId || !Types.ObjectId.isValid(subjectId)) {
        const errorMessage =
          "subjectId must be provided in query parameters and must be valid ObjectId.";
        socket.emit("error", { message: errorMessage });
        return;
      }
    } else if (!subjectId || !objectId || !Types.ObjectId.isValid(subjectId) || !Types.ObjectId.isValid(objectId)) {
      const errorMessage = "subjectId and objectId must be provided in query parameters and must be valid ObjectId.";
      socket.emit("error", { message: errorMessage });
      console.error(errorMessage);
      return;
    }

    let connectionType = "direct";
    if (!objectId) {
      connectionType = "self";
      objectId = subjectId;
    } else {
      connectionType = type || "direct";
    }

    const userRoom = getUserRoom(subjectId);
    socket.join(userRoom);

    // ── Multi-device: track this socket so we can notify other devices ──────
    // We store socket.id on the socket itself — getUserRoom already handles
    // broadcasting to all sockets in the room, so no extra Set needed.
    // socket.join(userRoom) automatically puts ALL devices of subjectId
    // in the same room — io.to(userRoom).emit() reaches all of them.

    const markFirstSocket = await markUserOnline(subjectId);

    if (markFirstSocket) {
      const peerIds = await loadAndCacheConversationPeers(subjectId);
      emitStatusToConversationPeers({ io, userId: subjectId, status: "online", peerIds });
    }

    const conversationRoom = resolveConversationRoom({
      subjectId,
      objectId,
      type: connectionType,
    });

    if (conversationRoom) {
      socket.join(conversationRoom);
    }

    // ── Chat listeners (unchanged) ─────────────────────────────────────────
    if (connectionType === "direct") {
      socket.on("sendDirectMessage", async (messageData) => {
        const { messageContent, messageType, mediaUrl } = messageData;
        io.to(getUserRoom(objectId)).emit("receiveMessage", {
          subjectId,
          messageContent,
          messageType,
          mediaUrl,
        });
      });
    } else if (connectionType === "group") {
      socket.on("sendGroupMessage", async (messageData) => {
        const { messageContent, messageType, mediaUrl } = messageData;
        if (!conversationRoom) return;
        socket.to(conversationRoom).emit("receiveMessage", {
          objectId,
          subjectId,
          messageContent,
          messageType,
          mediaUrl,
        });
      });
    }

    // ── Presence disconnect (chat) ─────────────────────────────────────────
    socket.on("disconnect", async () => {
      console.log(`User ${subjectId} disconnected.`);
      const isLastSocket = await markUserOffline(subjectId);
      if (isLastSocket) {
        await emitStatusToConversationPeers({ io, userId: subjectId, status: "offline" });
        await clearConversationPeers(subjectId);
      }
    });

    // ==========================
    // CALL HELPERS (unchanged)
    // ==========================
    const setCallPair = (a, b) => {
      activeCallMap.set(String(a), String(b));
      activeCallMap.set(String(b), String(a));
    };

    const clearCallPair = (a, b) => {
      activeCallMap.delete(String(a));
      activeCallMap.delete(String(b));
    };

    const getPartner = (userId) => {
      return activeCallMap.get(String(userId)) || null;
    };

    const isUserBusy = (userId) => {
      return !!activeCallMap.get(String(userId));
    };

    // ==========================
    // CALL EVENTS
    // ==========================

    // CALL INITIATE
    socket.on("callUser", async ({ targetUserId, offer }) => {
      const callerId = subjectId;
      const calleeId = String(targetUserId);

      console.log(`[CALL] ${callerId} -> ${calleeId}`);

      if (isUserBusy(callerId) || isUserBusy(calleeId)) {
        io.to(getUserRoom(callerId)).emit("callBusy", {
          targetUserId: calleeId,
          reason: "user_in_call",
        });
        return;
      }

      const caller = await User.findById(callerId)
        .select("name profileIcon")
        .lean();

      // getUserRoom already covers ALL devices of calleeId (all joined the same room)
      io.to(getUserRoom(calleeId)).emit("incomingCall", {
        callerId,
        callerName: caller?.name || "Unknown",
        callerAvatar: getFullImageUrl(caller?.profileIcon) || "",
        offer,
      });

      await sendUserNotifications({
        recipientIds: [calleeId],
        title: "Incoming Call",
        body: `${caller?.name || "Someone"} is calling you`,
        data: {
          type: "incoming_call",
          callerId,
          callerName: caller?.name || "Unknown",
          callerAvatar: getFullImageUrl(caller?.profileIcon) || "",
          offer: JSON.stringify(offer),
        },
        sender: subjectId,
        objectId: subjectId,
        saveNotification: true,
      });
    });

    // CALL ACCEPT
    socket.on("answerCall", ({ targetUserId, answer }) => {
      const calleeId = subjectId;
      const callerId = String(targetUserId);

      console.log(`[CALL ANSWERED] ${calleeId} -> ${callerId}`);

      if (getPartner(callerId) || getPartner(calleeId)) {
        return;
      }

      setCallPair(callerId, calleeId);

      // Send answer to caller (all caller devices)
      io.to(getUserRoom(callerId)).emit("callAnswered", {
        answer,
        calleeId,
      });

      // ── Notify all OTHER devices of the callee ─────────────────────────
      // e.g. user is logged in on phone + tablet — tablet answered,
      // phone must dismiss its IncomingCallScreen without emitting rejectCall
      socket.to(getUserRoom(calleeId)).emit("callAnsweredElsewhere", {
        callerId,
      });
    });

    // ICE CANDIDATE (unchanged)
    socket.on("iceCandidate", ({ targetUserId, candidate }) => {
      io.to(getUserRoom(String(targetUserId))).emit("iceCandidate", {
        candidate,
        fromUserId: subjectId,
      });
    });

    // REJECT CALL (unchanged)
    socket.on("rejectCall", ({ targetUserId }) => {
      const callerId = String(targetUserId);
      const rejecterId = subjectId;

      console.log(`[CALL REJECTED] ${rejecterId} -> ${callerId}`);

      const partner = getPartner(rejecterId);
      if (partner) {
        clearCallPair(rejecterId, partner);
        clearCallPair(partner, rejecterId);
      }

      clearCallPair(rejecterId, callerId);
      clearCallPair(callerId, rejecterId);

      io.to(getUserRoom(callerId)).emit("callRejected", {
        by: rejecterId,
      });

      // Also dismiss IncomingCallScreen on other devices of the rejecter
      socket.to(getUserRoom(rejecterId)).emit("callAnsweredElsewhere", {
        callerId,
      });
    });

    // END CALL (unchanged)
    socket.on("endCall", ({ targetUserId }) => {
      const otherUserId = String(targetUserId);
      const userId = subjectId;

      console.log(`[CALL ENDED] ${userId} <-> ${otherUserId}`);

      const partner = getPartner(userId);

      if (partner) {
        clearCallPair(userId, partner);
      }

      clearCallPair(userId, otherUserId);
      clearCallPair(otherUserId, userId);

      io.to(getUserRoom(otherUserId)).emit("callEnded", {
        by: userId,
      });

      if (partner && partner !== otherUserId) {
        io.to(getUserRoom(partner)).emit("callEnded", {
          by: userId,
        });
      }
    });

    // DISCONNECT CLEANUP (unchanged)
    socket.on("disconnect", async () => {
      console.log(`[DISCONNECT] ${subjectId}`);

      const partnerId = getPartner(subjectId);

      if (partnerId) {
        clearCallPair(subjectId, partnerId);
        io.to(getUserRoom(partnerId)).emit("callEnded", {
          by: subjectId,
        });
      }

      const isLastSocket = await markUserOffline(subjectId);

      if (isLastSocket) {
        await emitStatusToConversationPeers({
          io,
          userId: subjectId,
          status: "offline",
        });
        await clearConversationPeers(subjectId);
      }
    });

  });
};

module.exports = chatSocketHandler;