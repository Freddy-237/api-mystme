const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('./env');
const logger = require('../utils/logger');
const parseCookies = require('../utils/parseCookies');
const { extractBearerToken } = require('../utils/authToken');
const socketRateLimit = require('../utils/socketRateLimit');

let io;

/** Set of currently connected user IDs (in-memory). */
const onlineUsers = new Set();

const initSocket = (httpServer) => {
  const socketOrigin =
    env.corsOrigins.length > 0 ? env.corsOrigins : ['http://localhost:3000'];

  io = new Server(httpServer, {
    cors: {
      origin: socketOrigin,
      methods: ['GET', 'POST'],
    },
  });

  // JWT auth middleware — reject connections without a valid token
  io.use((socket, next) => {
    const authTokenRaw = socket.handshake.auth?.token;
    const authToken = typeof authTokenRaw === 'string' ? authTokenRaw.trim() : null;
    const authHeaderToken = extractBearerToken(socket.handshake.headers?.authorization);
    const cookieToken = parseCookies(socket.handshake.headers?.cookie || '')[env.authCookieName];
    const token = authToken || authHeaderToken || cookieToken;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      socket.user = jwt.verify(token, env.jwtSecret);
      next();
    } catch (_) {
      return next(new Error('Invalid token'));
    }
  });

  // ── Rate-limit guard factories (per-socket sliding window) ──────────────
  const joinGuard     = socketRateLimit('join_conversation',  { windowMs: 10_000, max: 10 });
  const leaveGuard    = socketRateLimit('leave_conversation', { windowMs: 10_000, max: 10 });
  const typingStartG  = socketRateLimit('typing_start',       { windowMs: 2_000,  max: 5  });
  const typingStopG   = socketRateLimit('typing_stop',        { windowMs: 2_000,  max: 5  });
  const readGuard     = socketRateLimit('messages_read',      { windowMs: 5_000,  max: 10 });

  io.on('connection', (socket) => {
    const uid = socket.user?.userId ?? socket.id;
    logger.info({ socketId: socket.id, userId: uid }, 'socket connected');

    socket.join(`user:${uid}`);

    // ── Presence tracking ──────────────────────────────────────────────────
    onlineUsers.add(uid);
    // Notify all rooms this user belongs to
    socket.broadcast.emit('user_online', { userId: uid });

    // Instantiate per-socket guard functions
    const canJoin       = joinGuard(socket);
    const canLeave      = leaveGuard(socket);
    const canTypingStart = typingStartG(socket);
    const canTypingStop  = typingStopG(socket);
    const canRead       = readGuard(socket);

    // Join a conversation room — verify user is a participant
    socket.on('join_conversation', async (conversationId) => {
      if (!canJoin()) return;
      try {
        const pool = require('./database');
        const result = await pool.query(
          'SELECT id FROM conversations WHERE id = $1 AND (owner_id = $2 OR anonymous_id = $2)',
          [conversationId, socket.user?.userId]
        );
        if (result.rows.length === 0) {
          socket.emit('error', { message: 'Non autorisé' });
          return;
        }
        socket.join(conversationId);
        logger.info({ userId: uid, conversationId }, 'socket joined conversation');
      } catch (err) {
        logger.error({ err, userId: uid, conversationId }, 'socket join conversation failed');
        socket.emit('error', { message: 'Erreur serveur' });
      }
    });

    // Leave a conversation room
    socket.on('leave_conversation', (conversationId) => {
      if (!canLeave()) return;
      socket.leave(conversationId);
    });

    // Typing indicators
    socket.on('typing_start', ({ conversationId }) => {
      if (!canTypingStart()) return;
      socket.to(conversationId).emit('typing_start', { userId: uid, conversationId });
    });

    socket.on('typing_stop', ({ conversationId }) => {
      if (!canTypingStop()) return;
      socket.to(conversationId).emit('typing_stop', { userId: uid, conversationId });
    });

    // Mark messages read — broadcast to other participant
    socket.on('messages_read', ({ conversationId }) => {
      if (!canRead()) return;
      socket.to(conversationId).emit('messages_read', { userId: uid, conversationId });
    });

    // Check if a user is online
    socket.on('check_presence', (targetUserId) => {
      socket.emit('presence_result', {
        userId: targetUserId,
        online: onlineUsers.has(targetUserId),
      });
    });

    socket.on('disconnect', () => {
      // Only mark offline if no other sockets for this user
      const room = io.sockets.adapter.rooms.get(`user:${uid}`);
      if (!room || room.size === 0) {
        onlineUsers.delete(uid);
        socket.broadcast.emit('user_offline', { userId: uid });
      }
      logger.info({ socketId: socket.id, userId: uid }, 'socket disconnected');
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

module.exports = { initSocket, getIO, onlineUsers };
