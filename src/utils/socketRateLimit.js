/**
 * Per-socket sliding-window rate limiter for Socket.io events.
 *
 * Usage:
 *   const guard = createSocketGuard('typing_start', { windowMs: 2000, max: 5 });
 *   // Inside connection handler:
 *   const checkTyping = guard(socket);
 *   socket.on('typing_start', (data) => {
 *     if (!checkTyping()) return;    // <-- returns false when rate exceeded
 *     // … handle event
 *   });
 *
 * When the limit is exceeded the socket receives an `error` event with
 * `{ message: 'Trop de requêtes', event }` and the guard returns false.
 */

const logger = require('./logger');

const createMemoryStore = () => {
  const buckets = new Map();

  return {
    async consume({ scope, key, windowMs, max }) {
      const bucketStartMs = Math.floor(Date.now() / windowMs) * windowMs;
      const bucketKey = `${scope}:${key}:${bucketStartMs}`;
      const hits = (buckets.get(bucketKey) || 0) + 1;
      buckets.set(bucketKey, hits);

      return {
        allowed: hits <= max,
        hits,
        remaining: Math.max(0, max - hits),
        resetAt: new Date(bucketStartMs + windowMs),
      };
    },
  };
};

/**
 * Creates a rate-limit guard factory for the given event name.
 *
 * @param {string}   eventName             Socket event name (for logging / error payload)
 * @param {object}   opts
 * @param {number}   [opts.windowMs=10000] Sliding window in ms
 * @param {number}   [opts.max=10]         Max allowed calls in the window
 * @returns {(socket: import('socket.io').Socket) => () => boolean}
 *   A factory that, given a socket, returns a guard function.
 *   Calling the guard returns `true` if allowed, `false` if rate-limited.
 */
function createSocketGuard(
  eventName,
  { windowMs = 10_000, max = 10, keyGenerator } = {},
  store = createMemoryStore(),
) {
  return (socket) => {
    return async () => {
      const uid = socket.user?.userId ?? socket.id;
      const rawKey = await Promise.resolve(
        keyGenerator ? keyGenerator(socket) : socket.user?.userId ?? socket.id,
      );
      const key = String(rawKey || socket.id);

      const result = await store.consume({
        scope: `socket:${eventName}`,
        key,
        windowMs,
        max,
      });

      if (!result.allowed) {
        logger.warn({ userId: uid, event: eventName, max, windowMs }, 'socket rate-limit exceeded');
        socket.emit('error', { message: 'Trop de requêtes', event: eventName });
        return false;
      }

      return true;
    };
  };
}

module.exports = createSocketGuard;

