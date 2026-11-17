/**
 * Web (PWA) identity rules — the PWA is a funnel towards the mobile app:
 *   - a web identity can write for WEB_TRIAL_DAYS after creation;
 *   - then it is LOCKED (read-only, "install the app") for WEB_LOCK_DAYS;
 *   - then it becomes eligible for purge (handled by the deletion job).
 * App identities never expire.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

const WEB_TRIAL_DAYS = 7;
const WEB_LOCK_DAYS = 30;
const WEB_MESSAGE_LIMIT = Math.max(
  1,
  parseInt(process.env.WEB_MESSAGE_LIMIT || '6', 10) || 6,
);

const ORIGINS = Object.freeze({ WEB: 'web', APP: 'app' });

const computeWebExpiresAt = (createdAt = new Date()) =>
  new Date(new Date(createdAt).getTime() + WEB_TRIAL_DAYS * DAY_MS);

const computeWebPurgeAt = (webExpiresAt) =>
  webExpiresAt ? new Date(new Date(webExpiresAt).getTime() + WEB_LOCK_DAYS * DAY_MS) : null;

/** True when a web identity's write window is over. App identities: never. */
const isWebLocked = (user, now = new Date()) => {
  if (!user || user.origin !== ORIGINS.WEB || !user.web_expires_at) return false;
  return now.getTime() >= new Date(user.web_expires_at).getTime();
};

module.exports = {
  WEB_TRIAL_DAYS,
  WEB_LOCK_DAYS,
  WEB_MESSAGE_LIMIT,
  ORIGINS,
  computeWebExpiresAt,
  computeWebPurgeAt,
  isWebLocked,
};
