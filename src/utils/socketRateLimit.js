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
function createSocketGuard(eventName, { windowMs = 10_000, max = 10 } = {}) {
  return (socket) => {
    const timestamps = [];

    return () => {
      const now = Date.now();

      // Purge timestamps outside the window
      while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
        timestamps.shift();
      }

      if (timestamps.length >= max) {
        const uid = socket.user?.userId ?? socket.id;
        logger.warn({ userId: uid, event: eventName, max, windowMs }, 'socket rate-limit exceeded');
        socket.emit('error', { message: 'Trop de requêtes', event: eventName });
        return false;
      }

      timestamps.push(now);
      return true;
    };
  };
}

module.exports = createSocketGuard;

