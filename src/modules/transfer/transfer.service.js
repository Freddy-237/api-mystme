/**
 * PWA → app transfer.
 *  1. The web identity asks for a short one-time code (POST /identity/transfer-token).
 *  2. The code travels to the freshly installed app: Android install referrer,
 *     iOS clipboard / manual entry, or the mystme://transfer deep link.
 *  3. The app (already holding its own identity) claims it
 *     (POST /identity/transfer/claim): the web identity is merged into it.
 */
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const AppError = require('../../utils/AppError');
const withTransaction = require('../../utils/withTransaction');
const repo = require('./transfer.repository');
const { ORIGINS } = require('../../config/webTrial');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LENGTH = 8;
const CODE_TTL_MINUTES = 30;

const hashCode = (code) => crypto.createHash('sha256').update(`transfer:${code}`).digest('hex');

const generateCode = () => {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
};

const formatCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** Accepts "abcd-2345", "MYSTME:ABCD2345", spaces… */
const normalizeCode = (raw) =>
  String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/^MYSTME[:\s-]*/, '')
    .replace(/[^A-Z0-9]/g, '');

const createTransferCode = async (webUserId) =>
  withTransaction(async (client) => {
    const users = await repo.lockUsers(client, [webUserId]);
    const user = users.get(webUserId);
    if (!user) throw new AppError('Utilisateur introuvable', 404);
    if (user.origin !== ORIGINS.WEB) {
      throw new AppError('Seule une session web peut être transférée', 400, 'NOT_A_WEB_IDENTITY');
    }

    // Only the latest code is valid.
    await repo.invalidateActiveTokens(client, webUserId);

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
    await repo.createToken(client, {
      id: randomUUID(),
      userId: webUserId,
      codeHash: hashCode(code),
      expiresAt,
    });

    return { code: formatCode(code), expiresAt: expiresAt.toISOString() };
  });

const claimTransferCode = async (appUserId, rawCode) => {
  const code = normalizeCode(rawCode);
  if (code.length !== CODE_LENGTH) {
    throw new AppError('Code de transfert invalide', 400, 'TRANSFER_CODE_INVALID');
  }

  return withTransaction(async (client) => {
    const token = await repo.findTokenByHashForUpdate(client, hashCode(code));
    if (!token) throw new AppError('Code de transfert invalide', 400, 'TRANSFER_CODE_INVALID');
    if (token.consumed_at) {
      throw new AppError('Ce code a déjà été utilisé', 409, 'TRANSFER_CODE_USED');
    }
    if (new Date(token.expires_at).getTime() < Date.now()) {
      throw new AppError('Ce code a expiré, génère-en un nouveau sur le web', 410, 'TRANSFER_CODE_EXPIRED');
    }
    if (token.user_id === appUserId) {
      throw new AppError('Code de transfert invalide', 400, 'TRANSFER_CODE_INVALID');
    }

    const users = await repo.lockUsers(client, [token.user_id, appUserId]);
    const webUser = users.get(token.user_id);
    const appUser = users.get(appUserId);

    if (!appUser || appUser.origin !== ORIGINS.APP) {
      throw new AppError('Le transfert se fait depuis l\'app MystMe', 403, 'APP_REQUIRED');
    }
    if (!webUser || webUser.merged_into_user_id) {
      throw new AppError('Ce code a déjà été utilisé', 409, 'TRANSFER_CODE_USED');
    }
    if (webUser.is_banned) {
      throw new AppError('Compte suspendu', 403, 'ACCOUNT_BANNED');
    }

    const result = await repo.mergeIdentities(client, webUser.id, appUserId);
    await repo.consumeToken(client, token.id, appUserId);

    return {
      ok: true,
      conversationIds: [...new Set([...result.moved, ...result.mergedInto])],
      skippedConversationIds: result.skipped,
    };
  });
};

module.exports = {
  CODE_LENGTH,
  CODE_TTL_MINUTES,
  normalizeCode,
  formatCode,
  hashCode,
  createTransferCode,
  claimTransferCode,
};
