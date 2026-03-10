const CONVERSATION_EXPIRY_DAYS = 7;
const CONVERSATION_EXPIRY_SQL_INTERVAL = `INTERVAL '${CONVERSATION_EXPIRY_DAYS} days'`;

const computeConversationExpiresAt = (startedAt) => {
  if (!startedAt) return null;

  const base = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (Number.isNaN(base.getTime())) return null;

  return new Date(base.getTime() + CONVERSATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
};

const isConversationExpired = (startedAt, now = new Date()) => {
  const expiresAt = computeConversationExpiresAt(startedAt);
  if (!expiresAt) return false;
  return now > expiresAt;
};

module.exports = {
  CONVERSATION_EXPIRY_DAYS,
  CONVERSATION_EXPIRY_SQL_INTERVAL,
  computeConversationExpiresAt,
  isConversationExpired,
};