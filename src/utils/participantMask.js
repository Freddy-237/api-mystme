/**
 * Anonymity guard.
 *
 * A user has ONE internal id, used both when they own a link and when they
 * write anonymously on someone else's link. If the link owner ever saw the
 * anonymous participant's real id, they could open a suspect's own link, read
 * its `owner_id`, compare, and unmask the sender.
 *
 * So the owner of a conversation never receives the anonymous participant's
 * real id: it is replaced everywhere (conversation, messages, socket events)
 * by a stable id derived from the conversation alone. It is the same for the
 * whole life of the conversation (even after a PWA → app transfer), different
 * in every conversation, and cannot be linked back to the user.
 *
 * The anonymous participant keeps seeing real ids: their own, and the owner's
 * (the owner is public by design — it is their link).
 */
const crypto = require('crypto');
const env = require('../config/env');

const maskedAnonymousId = (conversationId) => {
  const h = crypto
    .createHmac('sha256', env.jwtSecret)
    .update(`anonymous-participant:${conversationId}`)
    .digest('hex');
  // UUID-shaped so clients that parse/store ids as UUIDs keep working.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** True when `viewerId` is the link owner looking at an anonymous correspondent. */
const isOwnerView = (conversation, viewerId) =>
  !!conversation
  && !!viewerId
  && !!conversation.anonymous_id
  && conversation.owner_id === viewerId
  && conversation.anonymous_id !== viewerId;

/** The id `viewerId` is allowed to see for `userId` in this conversation. */
const visibleUserId = (conversation, userId, viewerId) => {
  if (userId == null) return userId;
  if (isOwnerView(conversation, viewerId) && userId === conversation.anonymous_id) {
    return maskedAnonymousId(conversation.id);
  }
  return userId;
};

/**
 * Id to put in an event broadcast to the *other* participant (typing, read
 * receipts): the anonymous side is always announced under its masked id.
 */
const broadcastUserId = (conversation, userId) => {
  if (conversation && conversation.anonymous_id && userId === conversation.anonymous_id
    && conversation.owner_id !== userId) {
    return maskedAnonymousId(conversation.id);
  }
  return userId;
};

const conversationForViewer = (conversation, viewerId) => {
  if (!conversation || !isOwnerView(conversation, viewerId)) return conversation;
  const out = { ...conversation, anonymous_id: maskedAnonymousId(conversation.id) };
  if (out.last_message_sender_id !== undefined) {
    out.last_message_sender_id = visibleUserId(conversation, conversation.last_message_sender_id, viewerId);
  }
  return out;
};

const messageForViewer = (message, conversation, viewerId) => {
  if (!message || !isOwnerView(conversation, viewerId)) return message;
  const out = { ...message, sender_id: visibleUserId(conversation, message.sender_id, viewerId) };
  if (out.reply_to_sender_id !== undefined) {
    out.reply_to_sender_id = visibleUserId(conversation, message.reply_to_sender_id, viewerId);
  }
  return out;
};

/**
 * Send one event to both participants, each with the payload they may see.
 * Every socket joins `user:<id>` on connection, so this reaches all devices.
 * @param {(viewerId: string) => object} buildPayload
 */
const emitToParticipants = (io, conversation, event, buildPayload) => {
  if (!conversation) return;
  const viewers = new Set([conversation.owner_id, conversation.anonymous_id].filter(Boolean));
  for (const viewerId of viewers) {
    io.to(`user:${viewerId}`).emit(event, buildPayload(viewerId));
  }
};

module.exports = {
  maskedAnonymousId,
  isOwnerView,
  visibleUserId,
  broadcastUserId,
  conversationForViewer,
  messageForViewer,
  emitToParticipants,
};
