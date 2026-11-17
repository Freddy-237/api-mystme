const pool = require('../../config/database');
const logger = require('../../utils/logger');

const createLink = async (link) => {
  logger.info({ linkId: link.id, ownerId: link.owner_id }, '[link.repo] createLink INSERT');
  const query = `
    INSERT INTO links (id, code, owner_id)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;
  const values = [link.id, link.code, link.owner_id];
  const result = await pool.query(query, values);
  logger.info({ linkId: result.rows[0]?.id }, '[link.repo] createLink OK');
  return result.rows[0];
};

const findByCode = async (code) => {
  logger.info('[link.repo] findByCode');
  const result = await pool.query('SELECT * FROM links WHERE code = $1 AND is_active = TRUE', [code]);
  logger.info({ found: !!result.rows[0] }, '[link.repo] findByCode result');
  return result.rows[0];
};

const findActiveByOwner = async (ownerId) => {
  const result = await pool.query(
    'SELECT * FROM links WHERE owner_id = $1 AND is_active = TRUE LIMIT 1',
    [ownerId],
  );
  return result.rows[0];
};

/** Public view of an invite code: never exposes the owner's internal id. */
const findPublicByCode = async (code) => {
  const result = await pool.query(
    `SELECT l.code, l.is_active, u.pseudo AS owner_pseudo
       FROM links l
       JOIN users u ON u.id = l.owner_id
      WHERE l.code = $1 AND l.is_active = TRUE`,
    [code],
  );
  return result.rows[0];
};

const findById = async (id) => {
  logger.info({ id }, '[link.repo] findById');
  const result = await pool.query('SELECT * FROM links WHERE id = $1', [id]);
  logger.info({ id, found: !!result.rows[0] }, '[link.repo] findById result');
  return result.rows[0];
};

const findByOwner = async (ownerId) => {
  logger.info({ ownerId }, '[link.repo] findByOwner');
  const result = await pool.query('SELECT * FROM links WHERE owner_id = $1 ORDER BY created_at DESC', [ownerId]);
  logger.info({ ownerId, count: result.rows.length }, '[link.repo] findByOwner result');
  return result.rows;
};

const deactivateLink = async (id) => {
  logger.info({ id }, '[link.repo] deactivateLink');
  const result = await pool.query('UPDATE links SET is_active = FALSE WHERE id = $1 RETURNING *', [id]);
  logger.info({ id, deactivated: !!result.rows[0] }, '[link.repo] deactivateLink result');
  return result.rows[0];
};

module.exports = {
  createLink,
  findByCode,
  findActiveByOwner,
  findPublicByCode,
  findById,
  findByOwner,
  deactivateLink,
};
