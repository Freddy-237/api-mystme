const { randomUUID: uuidv4 } = require('crypto');
const crypto = require('crypto');
const linkRepository = require('./link.repository');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const identityRepository = require('../identity/identity.repository');
const { ORIGINS } = require('../../config/webTrial');

const withShareUrl = (link) => ({ ...link, shareUrl: `/c/${link.code}` });

/** Generate a short 8-char invite code */
const generateCode = () => {
  return crypto.randomBytes(4).toString('hex'); // 8 hex chars
};

/**
 * Get-or-create: a user has exactly ONE active link (enforced by the
 * ux_links_one_active_per_owner index). Calling this twice — or twice at the
 * same time — returns the same link instead of creating a new one.
 * @returns {{ link: object, created: boolean }}
 */
const createLink = async (ownerId) => {
  const owner = await identityRepository.findAccessStateById(ownerId);
  if (owner?.origin === ORIGINS.WEB) {
    throw new AppError('Télécharge l\'app pour créer ton propre lien', 403, 'APP_REQUIRED');
  }

  const existing = await linkRepository.findActiveByOwner(ownerId);
  if (existing) return { link: withShareUrl(existing), created: false };

  try {
    const link = await linkRepository.createLink({
      id: uuidv4(),
      code: generateCode(),
      owner_id: ownerId,
    });
    logger.info({ ownerId, linkId: link.id }, '[link.service] createLink OK');
    return { link: withShareUrl(link), created: true };
  } catch (error) {
    // Concurrent request created it first (unique partial index).
    if (error?.code === '23505') {
      const winner = await linkRepository.findActiveByOwner(ownerId);
      if (winner) return { link: withShareUrl(winner), created: false };
    }
    throw error;
  }
};

const getLinkByCode = async (code) => {
  const link = await linkRepository.findPublicByCode(code);
  if (!link) throw new AppError('Lien introuvable ou inactif', 404);
  return link;
};

const getMyLinks = async (ownerId) => {
  logger.info({ ownerId }, '[link.service] getMyLinks');
  const links = await linkRepository.findByOwner(ownerId);
  logger.info({ ownerId, count: links.length, activeCount: links.filter(l => l.is_active).length }, '[link.service] getMyLinks OK');
  return links;
};

const deactivateLink = async (linkId, ownerId) => {
  logger.info({ linkId, ownerId }, '[link.service] deactivateLink');
  const existing = await linkRepository.findById(linkId);
  if (!existing) {
    logger.warn({ linkId }, '[link.service] deactivateLink — not found');
    throw new AppError('Lien introuvable', 404);
  }
  if (existing.owner_id !== ownerId) {
    logger.warn({ linkId, ownerId, actualOwner: existing.owner_id }, '[link.service] deactivateLink — not owner');
    throw new AppError('Non autorisé', 403);
  }
  const link = await linkRepository.deactivateLink(linkId);
  logger.info({ linkId }, '[link.service] deactivateLink OK');
  return link;
};

module.exports = {
  createLink,
  getLinkByCode,
  getMyLinks,
  deactivateLink,
};
