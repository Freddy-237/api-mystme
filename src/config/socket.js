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
    // Allow binary payloads up to 30 MB (images + audio via send_media).
    maxHttpBufferSize: 30 * 1024 * 1024,
  });

  // JWT auth middleware — reject connections without a valid token
  io.use((socket, next) => {
    const authTokenRaw = socket.handshake.auth?.token;
    const authToken = typeof authTokenRaw === 'string' ? authTokenRaw.trim() : null;
    const authHeaderToken = extractBearerToken(socket.handshake.headers?.authorization);
    const cookieToken = parseCookies(socket.handshake.headers?.cookie || '')[env.authCookieName];
    const token = authToken || authHeaderToken || cookieToken;
    if (!token) {
      logger.warn({ socketId: socket.id }, 'socket auth: no token');
      return next(new Error('Authentication required'));
    }
    try {
      socket.user = jwt.verify(token, env.jwtSecret);
      next();
    } catch (err) {
      logger.warn({ socketId: socket.id, err: err.message }, 'socket auth: invalid token');
      return next(new Error('Invalid token'));
    }
  });

  // ── Rate-limit guard factories (per-socket sliding window) ──────────────
  const joinGuard     = socketRateLimit('join_conversation',  { windowMs: 10_000, max: 10 });
  const leaveGuard    = socketRateLimit('leave_conversation', { windowMs: 10_000, max: 10 });
  const typingStartG  = socketRateLimit('typing_start',       { windowMs: 2_000,  max: 5  });
  const typingStopG   = socketRateLimit('typing_stop',        { windowMs: 2_000,  max: 5  });
  const readGuard     = socketRateLimit('messages_read',      { windowMs: 5_000,  max: 10 });
  const sendMediaG    = socketRateLimit('send_media',         { windowMs: 30_000, max: 10 });

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
    const canSendMedia  = sendMediaG(socket);

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

    // ── Media upload via socket ──────────────────────────────────────────────
    // Flutter sends raw bytes; we upload to Cloudinary and broadcast new_message.
    socket.on('send_media', async (data, ack) => {
      if (!canSendMedia()) return;
      const userId = socket.user?.userId;
      const { conversationId, mediaType, filename, bytes, caption } = data || {};

      if (!conversationId || !mediaType || !bytes) {
        const errMsg = 'Payload invalide (conversationId, mediaType, bytes requis)';
        logger.warn({ userId, conversationId, mediaType }, `send_media: ${errMsg}`);
        if (typeof ack === 'function') ack({ ok: false, error: errMsg });
        return;
      }

      try {
        logger.info({ userId, conversationId, mediaType, filename }, 'send_media:start');

        // Verify participant
        const pool = require('./database');
        const check = await pool.query(
          'SELECT id FROM conversations WHERE id = $1 AND (owner_id = $2 OR anonymous_id = $2)',
          [conversationId, userId],
        );
        if (check.rows.length === 0) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Non autorisé' });
          return;
        }

        // Convert received payload to Buffer
        let buffer;
        if (Buffer.isBuffer(bytes)) {
          buffer = bytes;
        } else if (Array.isArray(bytes)) {
          buffer = Buffer.from(bytes);
        } else {
          buffer = Buffer.from(Object.values(bytes));
        }
        logger.info({ userId, conversationId, mediaType, bufferBytes: buffer.length }, 'send_media:buffer');

        // Upload to Cloudinary
        const uploadService = require('../services/upload.service');
        let mediaUrl;
        switch (mediaType) {
          case 'image': mediaUrl = await uploadService.uploadImage(buffer, conversationId); break;
          case 'audio': mediaUrl = await uploadService.uploadAudio(buffer, conversationId); break;
          case 'video': mediaUrl = await uploadService.uploadVideo(buffer, conversationId); break;
          default:      mediaUrl = await uploadService.uploadFile(buffer, conversationId);  break;
        }
        logger.info({ userId, conversationId, mediaType, mediaUrl }, 'send_media:uploaded');

        // Persist message
        const messageService = require('../modules/message/message.service');
        const message = await messageService.createMediaMessage(
          conversationId, userId, mediaUrl, mediaType, caption || '',
        );
        logger.info({ userId, conversationId, messageId: message?.id }, 'send_media:saved');

        // Broadcast to all room participants
        const msgObj = {
          id:               message.id,
          conversation_id:  message.conversation_id,
          sender_id:        message.sender_id,
          content:          message.content || '',
          media_url:        message.media_url,
          media_type:       message.media_type,
          is_deleted:       message.is_deleted || false,
          created_at:       message.created_at,
          is_read:          false,
        };
        io.to(conversationId).emit('new_message', msgObj);

        if (typeof ack === 'function') ack({ ok: true, message: msgObj });
      } catch (err) {
        logger.error({ err, userId, conversationId, mediaType }, 'send_media:error');
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
        else socket.emit('media_error', { error: err.message, conversationId });
      }
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
