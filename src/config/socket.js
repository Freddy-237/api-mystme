const { Server } = require('socket.io');
const env = require('./env');
const logger = require('../utils/logger');
const parseCookies = require('../utils/parseCookies');
const { extractBearerToken } = require('../utils/authToken');
const socketRateLimit = require('../utils/socketRateLimit');
const distributedRateLimitStore = require('../utils/distributedRateLimitStore');
const conversationRepository = require('../modules/conversation/conversation.repository');
const { authenticateToken } = require('../modules/identity/identity.auth');

let io;

/** Set of currently connected user IDs (in-memory). */
const onlineUsers = new Set();

const getConversationId = (payload) => {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') return payload.conversationId;
  return null;
};

const getPresencePayload = (payload) => {
  if (typeof payload === 'string') {
    return { targetUserId: payload, conversationId: null };
  }
  if (payload && typeof payload === 'object') {
    return {
      targetUserId: payload.targetUserId || null,
      conversationId: payload.conversationId || null,
    };
  }
  return { targetUserId: null, conversationId: null };
};

const ensureConversationAccess = async (socket, payload, eventName) => {
  const conversationId = getConversationId(payload);
  const userId = socket.user?.userId;

  if (!conversationId) {
    socket.emit('error', { message: 'conversationId requis', event: eventName });
    return null;
  }

  const allowed = await conversationRepository.isParticipant(conversationId, userId);
  if (!allowed) {
    logger.warn({ userId, conversationId, event: eventName }, 'socket conversation access denied');
    socket.emit('error', { message: 'Non autorisé', event: eventName });
    return null;
  }

  return conversationId;
};

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
  io.use(async (socket, next) => {
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
      const user = await authenticateToken(token);
      socket.user = { userId: user.id };
      next();
    } catch (err) {
      logger.warn({ socketId: socket.id, err: err.message }, 'socket auth rejected');
      return next(new Error(err.statusCode === 403 ? err.message : 'Invalid token'));
    }
  });

  // ── Rate-limit guard factories (per-socket sliding window) ──────────────
  const joinGuard = socketRateLimit('join_conversation', { windowMs: 10_000, max: 10 }, distributedRateLimitStore);
  const leaveGuard = socketRateLimit('leave_conversation', { windowMs: 10_000, max: 10 }, distributedRateLimitStore);
  const typingStartG = socketRateLimit('typing_start', { windowMs: 2_000, max: 5 }, distributedRateLimitStore);
  const typingStopG = socketRateLimit('typing_stop', { windowMs: 2_000, max: 5 }, distributedRateLimitStore);
  const readGuard = socketRateLimit('messages_read', { windowMs: 5_000, max: 10 }, distributedRateLimitStore);
  const sendMediaG = socketRateLimit('send_media', { windowMs: 30_000, max: 10 }, distributedRateLimitStore);

  io.on('connection', (socket) => {
    const uid = socket.user?.userId ?? socket.id;
    logger.info({ socketId: socket.id, userId: uid }, 'socket connected');

    socket.join(`user:${uid}`);

    // ── Presence tracking ──────────────────────────────────────────────────
    onlineUsers.add(uid);
    // Notify only conversation rooms this user belongs to (not global broadcast)
    _emitPresenceToConversations(socket, uid, 'user_online');

    // Instantiate per-socket guard functions
    const canJoin       = joinGuard(socket);
    const canLeave      = leaveGuard(socket);
    const canTypingStart = typingStartG(socket);
    const canTypingStop  = typingStopG(socket);
    const canRead       = readGuard(socket);
    const canSendMedia  = sendMediaG(socket);

    // Join a conversation room — verify user is a participant
    socket.on('join_conversation', async (conversationId) => {
      if (!(await canJoin())) return;
      try {
        const authorizedConversationId = await ensureConversationAccess(socket, conversationId, 'join_conversation');
        if (!authorizedConversationId) return;
        socket.join(authorizedConversationId);
        logger.info({ userId: uid, conversationId: authorizedConversationId }, 'socket joined conversation');
      } catch (err) {
        logger.error({ err, userId: uid, conversationId }, 'socket join conversation failed');
        socket.emit('error', { message: 'Erreur serveur' });
      }
    });

    // Leave a conversation room
    socket.on('leave_conversation', (conversationId) => {
      void (async () => {
        if (!(await canLeave())) return;
        socket.leave(conversationId);
      })();
    });

    // Typing indicators
    socket.on('typing_start', async (payload) => {
      if (!(await canTypingStart())) return;
      const conversationId = await ensureConversationAccess(socket, payload, 'typing_start');
      if (!conversationId) return;
      socket.join(conversationId);
      socket.to(conversationId).emit('typing_start', { userId: uid, conversationId });
    });

    socket.on('typing_stop', async (payload) => {
      if (!(await canTypingStop())) return;
      const conversationId = await ensureConversationAccess(socket, payload, 'typing_stop');
      if (!conversationId) return;
      socket.join(conversationId);
      socket.to(conversationId).emit('typing_stop', { userId: uid, conversationId });
    });

    // Mark messages read — broadcast to other participant
    socket.on('messages_read', async (payload) => {
      if (!(await canRead())) return;
      const conversationId = await ensureConversationAccess(socket, payload, 'messages_read');
      if (!conversationId) return;
      socket.join(conversationId);
      socket.to(conversationId).emit('messages_read', { userId: uid, conversationId });
    });

    // ── Media upload via socket ──────────────────────────────────────────────
    // Flutter sends raw bytes; we upload to Cloudinary and broadcast new_message.
    socket.on('send_media', async (data, ack) => {
      if (!(await canSendMedia())) return;
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

        const authorizedConversationId = await ensureConversationAccess(socket, conversationId, 'send_media');
        if (!authorizedConversationId) {
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
        const { message, activatedConversation } = await messageService.createMediaMessageWithConversationState(
          conversationId, userId, mediaUrl, mediaType, caption || '',
        );
        logger.info({ userId, conversationId, messageId: message?.id }, 'send_media:saved');

        if (activatedConversation) {
          io.to(`user:${activatedConversation.owner_id}`).emit('new_conversation', activatedConversation);
          io.to(`user:${activatedConversation.anonymous_id}`).emit('new_conversation', activatedConversation);
        }

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
        socket.join(authorizedConversationId);
        io.to(authorizedConversationId).emit('new_message', msgObj);

        if (typeof ack === 'function') ack({ ok: true, message: msgObj });
      } catch (err) {
        logger.error({ err, userId, conversationId, mediaType }, 'send_media:error');
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
        else socket.emit('media_error', { error: err.message, conversationId });
      }
    });

    // Check if a user is online
    socket.on('check_presence', async (payload) => {
      const userId = socket.user?.userId;
      const { targetUserId, conversationId } = getPresencePayload(payload);

      if (!targetUserId) {
        socket.emit('error', { message: 'targetUserId requis', event: 'check_presence' });
        return;
      }

      let allowed = targetUserId === userId;
      if (!allowed && conversationId) {
        const authorizedConversationId = await ensureConversationAccess(socket, { conversationId }, 'check_presence');
        if (!authorizedConversationId) return;
        const conversation = await conversationRepository.findById(authorizedConversationId);
        allowed = !!conversation && (conversation.owner_id === targetUserId || conversation.anonymous_id === targetUserId);
      }

      if (!allowed) {
        allowed = await conversationRepository.hasSharedConversation(userId, targetUserId);
      }

      if (!allowed) {
        logger.warn({ userId, targetUserId }, 'socket presence access denied');
        socket.emit('error', { message: 'Non autorisé', event: 'check_presence' });
        return;
      }

      socket.emit('presence_result', {
        userId: targetUserId,
        conversationId: conversationId || null,
        online: onlineUsers.has(targetUserId),
      });
    });

    socket.on('disconnect', () => {
      // Only mark offline if no other sockets for this user
      const room = io.sockets.adapter.rooms.get(`user:${uid}`);
      if (!room || room.size === 0) {
        onlineUsers.delete(uid);
        _emitPresenceToConversations(socket, uid, 'user_offline');
      }
      logger.info({ socketId: socket.id, userId: uid }, 'socket disconnected');
    });
  });

  return io;
};

/**
 * Emit a presence event only to the socket rooms that represent actual
 * conversations (UUID-shaped room names), skipping the personal `user:*` room.
 */
function _emitPresenceToConversations(socket, userId, event) {
  for (const room of socket.rooms) {
    // Skip personal room and the socket's own id room
    if (room === socket.id || room.startsWith('user:')) continue;
    socket.to(room).emit(event, { userId });
  }
}

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

module.exports = { initSocket, getIO, onlineUsers };
