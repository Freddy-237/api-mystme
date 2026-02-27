const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('./env');
const logger = require('../utils/logger');
const parseCookies = require('../utils/parseCookies');

let io;

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
    const authToken = socket.handshake.auth?.token;
    const cookieToken = parseCookies(socket.handshake.headers?.cookie || '')[env.authCookieName];
    const token = authToken || cookieToken;
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

  io.on('connection', (socket) => {
    const uid = socket.user?.userId ?? socket.id;
    logger.info({ socketId: socket.id, userId: uid }, 'socket connected');

    // Join a conversation room — verify user is a participant
    socket.on('join_conversation', async (conversationId) => {
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
      socket.leave(conversationId);
    });

    // Typing indicators
    socket.on('typing_start', ({ conversationId }) => {
      socket.to(conversationId).emit('typing_start', { userId: uid, conversationId });
    });

    socket.on('typing_stop', ({ conversationId }) => {
      socket.to(conversationId).emit('typing_stop', { userId: uid, conversationId });
    });

    // Mark messages read — broadcast to other participant
    socket.on('messages_read', ({ conversationId }) => {
      socket.to(conversationId).emit('messages_read', { userId: uid, conversationId });
    });

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id, userId: uid }, 'socket disconnected');
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

module.exports = { initSocket, getIO };
