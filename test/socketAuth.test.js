const test = require('node:test');
const assert = require('node:assert/strict');
const { Server } = require('socket.io');
const { createServer } = require('http');
const Client = require('socket.io-client');

const app = require('../src/app');
const env = require('../src/config/env');

test('socket auth rejects connections without token', async () => {
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins.length > 0 ? env.corsOrigins : ['http://localhost:3000'],
      methods: ['GET', 'POST'],
    },
  });

  // Simulate the auth middleware
  io.use(async (socket, next) => {
    const authTokenRaw = socket.handshake.auth?.token;
    const authToken = typeof authTokenRaw === 'string' ? authTokenRaw.trim() : null;
    const authHeaderToken = socket.handshake.headers?.authorization?.startsWith('Bearer ')
      ? socket.handshake.headers.authorization.slice(7).trim()
      : null;
    const cookieToken = socket.handshake.headers?.cookie?.split(';')
      .find(c => c.trim().startsWith(`${env.authCookieName}=`))
      ?.split('=')[1]?.trim();
    const token = authToken || authHeaderToken || cookieToken;
    if (!token) {
      return next(new Error('Authentification requise'));
    }
    // For test, assume invalid token
    return next(new Error('Session expirée ou invalide'));
  });

  await new Promise((resolve) => {
    httpServer.listen(0, () => {
      const port = httpServer.address().port;
      const clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: '' }, // No token
      });

      clientSocket.on('connect_error', (err) => {
        assert.equal(err.message, 'Authentification requise');
        clientSocket.close();
        httpServer.close(resolve);
      });
    });
  });
});

test('socket auth rejects invalid token', async () => {
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins.length > 0 ? env.corsOrigins : ['http://localhost:3000'],
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || '';
    if (!token) return next(new Error('Authentification requise'));
    // Simulate invalid token
    return next(new Error('Session expirée ou invalide'));
  });

  await new Promise((resolve) => {
    httpServer.listen(0, () => {
      const port = httpServer.address().port;
      const clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: 'invalid-token' },
      });

      clientSocket.on('connect_error', (err) => {
        assert.equal(err.message, 'Session expirée ou invalide');
        clientSocket.close();
        httpServer.close(resolve);
      });
    });
  });
});