const { Server } = require('socket.io');
const env = require('./env');
const logger = require('../utils/logger');
const parseCookies = require('../utils/parseCookies');
const { extractBearerToken } = require('../utils/authToken');
const socketRateLimit = require('../utils/socketRateLimit');
const distributedRateLimitStore = require('../utils/distributedRateLimitStore');
const conversationRepository = require('../modules/conversation/conversation.repository');
const { authenticateToken } = require('../modules/identity/identity.auth');
const AppError = require('../utils/AppError');
const { isAllowedSocketMedia } = require('../utils/mediaPolicy');
const {
  broadcastUserId,
  conversationForViewer,
  messageForViewer,
  emitToParticipants,
} = require('../utils/participantMask');

let io;

const SOCKET_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_SOCKET_MEDIA_TYPES = new Set(['image', 'audio', 'video', 'file']);

const toSocketErrorPayload = ({
  message,
  event,
  code = 'SOCKET_ERROR',
  requestId = null,
}) => ({
  error: true,
  code,
  message,
  event: event || null,
  requestId,
});

const emitSocketError = (socket, {
  message,
  event,
  code,
}) => {
  socket.emit('error', toSocketErrorPayload({
    message,
    event,
    code,
    requestId: socket.id,
  }));
};

const rejectSocketAck = (ack, {
  message,
  event,
  code,
}) => {
  if (typeof ack !== 'function') return;
  ack({
    ok: false,
    error: message,
    ...toSocketErrorPayload({
      message,
      event,
      code,
    }),
  });
};

/** Set of currently connected user IDs (in-memory). */
const onlineUsers = new Set();

/**
 * Presence is one-way. A link owner is public, so their anonymous
 * correspondents may see them online. The reverse is never broadcast: seeing
 * when an anonymous sender is online lets the owner guess who they are.
 */
const getPresenceAudienceUserIds = (conversations, userId) => {
  const audience = new Set();

  for (const conversation of conversations || []) {
    if (conversation.owner_id !== userId) continue;
    const peerId = conversation.anonymous_id;
    if (peerId && peerId !== userId) {
      audience.add(peerId);
    }
  }

  return [...audience];
};

const emitPresenceToPeers = async (
  emitter,
  userId,
  event,
  repository = conversationRepository,
) => {
  try {
    const conversations = await repository.findOwnedConversationPeers(userId);
    const audienceUserIds = getPresenceAudienceUserIds(conversations, userId);

    for (const peerId of audienceUserIds) {
      emitter.to(`user:${peerId}`).emit(event, { userId });
    }
  } catch (error) {
    logger.warn({ err: error, userId, event }, 'socket presence emit failed');
  }
};

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
    emitSocketError(socket, {
      message: 'conversationId requis',
      event: eventName,
      code: 'BAD_REQUEST',
    });
    return null;
  }

  const allowed = await conversationRepository.isParticipant(conversationId, userId);
  if (!allowed) {
    logger.warn({ userId, conversationId, event: eventName }, 'socket conversation access denied');
    emitSocketError(socket, {
      message: 'Non autorisé',
      event: eventName,
      code: 'FORBIDDEN',
    });
    return null;
  }

  return conversationId;
};

/**
 * Id under which `userId` is announced to the other participant (typing,
 * read receipts): the anonymous side only ever appears under its masked id.
 */
const resolveBroadcastUserId = async (conversationId, userId) => {
  const participants = await conversationRepository.findParticipants(conversationId);
  return broadcastUserId(participants, userId);
};

const normalizeSocketMediaPayload = (data) => {
  const payload = data && typeof data === 'object' ? data : {};
  const conversationId = typeof payload.conversationId === 'string'
    ? payload.conversationId.trim()
    : '';
  const mediaType = typeof payload.mediaType === 'string'
    ? payload.mediaType.trim().toLowerCase()
    : '';
  const filename = typeof payload.filename === 'string'
    ? payload.filename.trim()
    : '';
  const caption = typeof payload.caption === 'string'
    ? payload.caption.trim()
    : '';
  const rawBytes = payload.bytes;

  if (!conversationId || !mediaType || rawBytes == null) {
    throw new AppError('Payload invalide (conversationId, mediaType, bytes requis)', 400);
  }

  if (!ALLOWED_SOCKET_MEDIA_TYPES.has(mediaType)) {
    throw new AppError('Type de media invalide', 400);
  }

  if (!isAllowedSocketMedia(mediaType, filename)) {
    throw new AppError('Type de fichier non autorisé', 400);
  }

  let buffer;
  if (Buffer.isBuffer(rawBytes)) {
    buffer = rawBytes;
  } else if (Array.isArray(rawBytes)) {
    buffer = Buffer.from(rawBytes);
  } else if (rawBytes && typeof rawBytes === 'object') {
    buffer = Buffer.from(Object.values(rawBytes));
  } else {
    throw new AppError('Payload bytes invalide', 400);
  }

  if (!buffer.length) {
    throw new AppError('Fichier vide', 400);
  }

  if (buffer.length > SOCKET_MEDIA_MAX_BYTES) {
    throw new AppError('Fichier trop volumineux (max 25 Mo)', 413);
  }

  if (caption.length > 5000) {
    throw new AppError('Caption trop longue (max 5000 caractères)', 400);
  }

  return {
    conversationId,
    mediaType,
    filename,
    caption,
    buffer,
  };
};

const initSocket = (httpServer) => {
  if (process.env.NODE_ENV === 'production' && env.corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS required in production for Socket.IO');
  }

  const socketOrigin =
    env.corsOrigins.length > 0 ? env.corsOrigins : ['http://localhost:3000'];

  io = new Server(httpServer, {
    cors: {
      origin: socketOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
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
      return next(new Error('Authentification requise'));
    }
    try {
      const user = await authenticateToken(token);
      socket.user = { userId: user.id };
      next();
    } catch (err) {
      logger.warn({ socketId: socket.id, err: err.message }, 'socket auth rejected');
      return next(new Error(err.statusCode === 403 ? err.message : 'Session expirée ou invalide'));
    }
  });

  // ── Rate-limit guard factories (per-socket sliding window) ──────────────
  const joinGuard = socketRateLimit('join_conversation', { windowMs: 10_000, max: 10 }, distributedRateLimitStore);
  const leaveGuard = socketRateLimit('leave_conversation', { windowMs: 10_000, max: 10 }, distributedRateLimitStore);
  const typingStartG = socketRateLimit('typing_start', { windowMs: 2_000, max: 5 }, distributedRateLimitStore);
  const typingStopG = socketRateLimit('typing_stop', { windowMs: 2_000, max: 5 }, distributedRateLimitStore);
  const readGuard = socketRateLimit('messages_read', { windowMs: 5_000, max: 10 }, distributedRateLimitStore);
  const sendMediaG = socketRateLimit('send_media', { windowMs: 60_000, max: 6 }, distributedRateLimitStore);

  io.on('connection', (socket) => {
    const uid = socket.user?.userId ?? socket.id;
    logger.info({ socketId: socket.id, userId: uid }, 'socket connected');

    socket.join(`user:${uid}`);

    // ── Presence tracking ──────────────────────────────────────────────────
    onlineUsers.add(uid);
    void emitPresenceToPeers(io, uid, 'user_online');

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
        emitSocketError(socket, {
          message: 'Le service est temporairement indisponible. Réessaie plus tard.',
          event: 'join_conversation',
          code: 'SERVER_ERROR',
        });
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
      const visibleId = await resolveBroadcastUserId(conversationId, uid);
      socket.to(conversationId).emit('typing_start', { userId: visibleId, conversationId });
    });

    socket.on('typing_stop', async (payload) => {
      if (!(await canTypingStop())) return;
      const conversationId = await ensureConversationAccess(socket, payload, 'typing_stop');
      if (!conversationId) return;
      socket.join(conversationId);
      const visibleId = await resolveBroadcastUserId(conversationId, uid);
      socket.to(conversationId).emit('typing_stop', { userId: visibleId, conversationId });
    });

    // Mark messages read — broadcast to other participant
    socket.on('messages_read', async (payload) => {
      if (!(await canRead())) return;
      const conversationId = await ensureConversationAccess(socket, payload, 'messages_read');
      if (!conversationId) return;
      socket.join(conversationId);
      const visibleId = await resolveBroadcastUserId(conversationId, uid);
      socket.to(conversationId).emit('messages_read', { userId: visibleId, conversationId });
    });

    // ── Media upload via socket ──────────────────────────────────────────────
    // Flutter sends raw bytes; we upload to Cloudinary and broadcast new_message.
    socket.on('send_media', async (data, ack) => {
      if (!(await canSendMedia())) return;
      const userId = socket.user?.userId;
      let payload;

      try {
        payload = normalizeSocketMediaPayload(data);
      } catch (error) {
        logger.warn({ err: error, userId }, 'send_media:invalid-payload');
        rejectSocketAck(ack, {
          message: error.message,
          event: 'send_media',
          code: 'BAD_REQUEST',
        });
        return;
      }

      const {
        conversationId,
        mediaType,
        filename,
        caption,
        buffer,
      } = payload;

      try {
        logger.info({ userId, conversationId, mediaType, filename }, 'send_media:start');

        const authorizedConversationId = await ensureConversationAccess(socket, conversationId, 'send_media');
        if (!authorizedConversationId) {
          rejectSocketAck(ack, {
            message: 'Non autorisé',
            event: 'send_media',
            code: 'FORBIDDEN',
          });
          return;
        }

        const messageService = require('../modules/message/message.service');
        await messageService.assertConversationWritable(authorizedConversationId, userId);

        logger.info(
          { userId, conversationId: authorizedConversationId, mediaType, bufferBytes: buffer.length },
          'send_media:buffer',
        );

        // Upload to Cloudinary
        const uploadService = require('../services/upload.service');
        let mediaUrl;
        switch (mediaType) {
          case 'image': mediaUrl = await uploadService.uploadImage(buffer, authorizedConversationId); break;
          case 'audio': mediaUrl = await uploadService.uploadAudio(buffer, authorizedConversationId); break;
          case 'video': mediaUrl = await uploadService.uploadVideo(buffer, authorizedConversationId); break;
          default:      mediaUrl = await uploadService.uploadFile(buffer, authorizedConversationId);  break;
        }
        logger.info({ userId, conversationId: authorizedConversationId, mediaType, mediaUrl }, 'send_media:uploaded');

        // Persist message
        const { message, activatedConversation } = await messageService.createMediaMessageWithConversationState(
          authorizedConversationId, userId, mediaUrl, mediaType, caption,
        );
        logger.info({ userId, conversationId: authorizedConversationId, messageId: message?.id }, 'send_media:saved');

        // Each participant gets the payload they may see (the owner never
        // receives the anonymous participant's real id).
        const participants = await conversationRepository.findParticipants(authorizedConversationId);

        if (activatedConversation) {
          emitToParticipants(io, activatedConversation, 'new_conversation', (viewerId) =>
            conversationForViewer(activatedConversation, viewerId));
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
        emitToParticipants(io, participants, 'new_message', (viewerId) =>
          messageForViewer(msgObj, participants, viewerId));

        if (typeof ack === 'function') {
          ack({ ok: true, message: messageForViewer(msgObj, participants, userId) });
        }
      } catch (err) {
        logger.error({ err, userId, conversationId, mediaType }, 'send_media:error');
        const message = err?.statusCode >= 500
          ? 'Le service est temporairement indisponible. Réessaie plus tard.'
          : (err.message || 'Envoi du média impossible');
        // Business codes (WEB_TRIAL_EXPIRED, WEB_MESSAGE_LIMIT…) reach the client.
        const businessCode = err?.name === 'AppError' && err?.statusCode < 500 && typeof err.code === 'string'
          ? err.code
          : null;
        if (typeof ack === 'function') {
          rejectSocketAck(ack, {
            message,
            event: 'send_media',
            code: businessCode || (err?.statusCode >= 500 ? 'SERVER_ERROR' : 'SEND_MEDIA_FAILED'),
          });
        } else {
          socket.emit('media_error', {
            error: true,
            code: businessCode || (err?.statusCode >= 500 ? 'SERVER_ERROR' : 'SEND_MEDIA_FAILED'),
            message,
            conversationId,
            requestId: socket.id,
          });
        }
      }
    });

    // Check if a user is online
    socket.on('check_presence', async (payload) => {
      const userId = socket.user?.userId;
      const { targetUserId, conversationId } = getPresencePayload(payload);

      if (!targetUserId) {
        emitSocketError(socket, {
          message: 'targetUserId requis',
          event: 'check_presence',
          code: 'BAD_REQUEST',
        });
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

      // Unknown ids (including the masked id an owner holds for an anonymous
      // correspondent) simply read as offline: nothing to learn from them.
      // An owner may never read the presence of someone writing to them
      // anonymously, even with a real id kept from an older app version.
      const hidden = !allowed
        || (targetUserId !== userId
          && await conversationRepository.isAnonymousCorrespondentOf(userId, targetUserId));

      socket.emit('presence_result', {
        userId: targetUserId,
        conversationId: conversationId || null,
        online: hidden ? false : onlineUsers.has(targetUserId),
      });
    });

    socket.on('disconnect', () => {
      // Only mark offline if no other sockets for this user
      const room = io.sockets.adapter.rooms.get(`user:${uid}`);
      if (!room || room.size === 0) {
        onlineUsers.delete(uid);
        void emitPresenceToPeers(io, uid, 'user_offline');
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

module.exports = {
  initSocket,
  getIO,
  onlineUsers,
  __private: {
    emitPresenceToPeers,
    getPresenceAudienceUserIds,
    normalizeSocketMediaPayload,
    toSocketErrorPayload,
  },
};
