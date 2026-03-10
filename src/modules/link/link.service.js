const { randomUUID: uuidv4 } = require('crypto');
const crypto = require('crypto');
const linkRepository = require('./link.repository');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');

/** Generate a short 8-char invite code */
const generateCode = () => {
  return crypto.randomBytes(4).toString('hex'); // 8 hex chars
};

const createLink = async (ownerId) => {
  const code = generateCode();
  logger.info({ ownerId }, '[link.service] createLink');
  const link = await linkRepository.createLink({
    id: uuidv4(),
    code,
    owner_id: ownerId,
  });
  logger.info({ ownerId, linkId: link.id }, '[link.service] createLink OK');
  return {
    ...link,
    shareUrl: `/c/${link.code}`,
  };
};

const getLinkByCode = async (code) => {
  logger.info('[link.service] getLinkByCode');
  const link = await linkRepository.findByCode(code);
  if (!link) {
    logger.warn('[link.service] getLinkByCode — not found');
    throw new AppError('Lien introuvable ou inactif', 404);
  }
  logger.info({ linkId: link.id, ownerId: link.owner_id, isActive: link.is_active }, '[link.service] getLinkByCode OK');
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
