const { randomUUID: uuidv4 } = require('crypto');
const crypto = require('crypto');
const linkRepository = require('./link.repository');

/** Generate a short 8-char invite code */
const generateCode = () => {
  return crypto.randomBytes(4).toString('hex'); // 8 hex chars
};

const createLink = async (ownerId) => {
  const link = await linkRepository.createLink({
    id: uuidv4(),
    code: generateCode(),
    owner_id: ownerId,
  });
  return {
    ...link,
    shareUrl: `/c/${link.code}`,
  };
};

const getLinkByCode = async (code) => {
  const link = await linkRepository.findByCode(code);
  if (!link) throw Object.assign(new Error('Lien introuvable ou inactif'), { statusCode: 404 });
  return link;
};

const getMyLinks = async (ownerId) => {
  return linkRepository.findByOwner(ownerId);
};

const deactivateLink = async (linkId, ownerId) => {
  // Verify ownership before deactivation
  const existing = await linkRepository.findById(linkId);
  if (!existing) throw Object.assign(new Error('Lien introuvable'), { statusCode: 404 });
  if (existing.owner_id !== ownerId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }
  const link = await linkRepository.deactivateLink(linkId);
  return link;
};

module.exports = {
  createLink,
  getLinkByCode,
  getMyLinks,
  deactivateLink,
};
