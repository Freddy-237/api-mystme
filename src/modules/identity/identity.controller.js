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

    res.status(201).json(data);
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
    const user = await identityService.updatePseudo(req.user.id, req.body.pseudo);
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

const updateBio = async (req, res, next) => {
  try {
    const user = await identityService.updateBio(req.user.id, req.body.bio);
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

module.exports = {
  initIdentity,
  getMe,
  updatePseudo,
  updateBio,
  updatePushToken,
  logout,
  refreshCsrf,
};
