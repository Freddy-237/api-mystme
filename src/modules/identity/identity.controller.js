const identityService = require('./identity.service');
const env = require('../../config/env');
const { randomUUID } = require('crypto');

const buildCookieOptions = (httpOnly) => ({
  httpOnly,
  secure: env.isProduction,
  sameSite: env.isProduction ? 'none' : 'lax',
  domain: env.authCookieDomain,
  path: '/',
  maxAge: 1000 * 60 * 60 * 24 * 30,
});

const initIdentity = async (req, res, next) => {
  try {
    const data = await identityService.initIdentity();
    const csrfToken = randomUUID();

    res.cookie(env.authCookieName, data.token, buildCookieOptions(true));
    res.cookie(env.csrfCookieName, csrfToken, buildCookieOptions(false));

    // Include csrfToken in the response body so cross-origin PWA clients
    // (which cannot read the cookie) can store it in memory.
    res.status(201).json({ ...data, csrfToken });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await identityService.getMe(req.user.id);
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

const updatePseudo = async (req, res, next) => {
  try {
    const { pseudo } = req.body;
    if (!pseudo || typeof pseudo !== 'string') {
      return res.status(400).json({ message: 'pseudo requis' });
    }
    const trimmed = pseudo.trim();
    if (trimmed.length < 2 || trimmed.length > 30) {
      return res.status(400).json({ message: 'Le pseudo doit contenir entre 2 et 30 caractères' });
    }
    const user = await identityService.updatePseudo(req.user.id, trimmed);
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

const updateBio = async (req, res, next) => {
  try {
    const { bio } = req.body;
    if (bio !== undefined && typeof bio !== 'string') {
      return res.status(400).json({ message: 'bio invalide' });
    }
    const trimmed = (bio || '').trim();
    if (trimmed.length > 300) {
      return res.status(400).json({ message: 'La bio ne doit pas dépasser 300 caractères' });
    }
    const user = await identityService.updateBio(req.user.id, trimmed);
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

const updatePushToken = async (req, res, next) => {
  try {
    const user = await identityService.updatePushToken(req.user.id, req.body.token);
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

const logout = async (_req, res, next) => {
  try {
    res.clearCookie(env.authCookieName, {
      ...buildCookieOptions(true),
      maxAge: undefined,
    });
    res.clearCookie(env.csrfCookieName, {
      ...buildCookieOptions(false),
      maxAge: undefined,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
};

const refreshCsrf = async (_req, res, next) => {
  try {
    const csrfToken = randomUUID();
    res.cookie(env.csrfCookieName, csrfToken, {
      ...buildCookieOptions(false),
    });
    res.status(200).json({ csrfToken });
  } catch (error) {
    next(error);
  }
};

const issueSessionToken = async (req, res, next) => {
  try {
    const data = await identityService.issueSessionToken(req.user.id);
    res.cookie(env.authCookieName, data.token, buildCookieOptions(true));
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

const requestEmailOtp = async (req, res, next) => {
  try {
    const data = await identityService.requestEmailOtp(req.user.id, req.body.email);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

const verifyEmailOtp = async (req, res, next) => {
  try {
    const data = await identityService.verifyEmailOtp(
      req.user.id,
      req.body.email,
      req.body.code,
    );
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

const createRecoveryKey = async (req, res, next) => {
  try {
    const data = await identityService.generateRecoveryKey(req.user.id);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

const restoreByRecoveryKey = async (req, res, next) => {
  try {
    const data = await identityService.restoreByRecoveryKey(req.body.recoveryKey);
    const csrfToken = randomUUID();

    res.cookie(env.authCookieName, data.token, buildCookieOptions(true));
    res.cookie(env.csrfCookieName, csrfToken, buildCookieOptions(false));
    res.status(200).json({ ...data, csrfToken });
  } catch (error) {
    next(error);
  }
};

const requestEmailRestore = async (req, res, next) => {
  try {
    const data = await identityService.requestEmailRestore(req.body.email);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

const verifyEmailRestore = async (req, res, next) => {
  try {
    const data = await identityService.verifyEmailRestore(req.body.email, req.body.code);
    const csrfToken = randomUUID();

    res.cookie(env.authCookieName, data.token, buildCookieOptions(true));
    res.cookie(env.csrfCookieName, csrfToken, buildCookieOptions(false));
    res.status(200).json({ ...data, csrfToken });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  initIdentity,
  getMe,
  updatePseudo,
  updateBio,
  updatePushToken,
  logout,
  refreshCsrf,
  issueSessionToken,
  createRecoveryKey,
  restoreByRecoveryKey,
  requestEmailOtp,
  verifyEmailOtp,
  requestEmailRestore,
  verifyEmailRestore,
};
