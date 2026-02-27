const pool = require('../../config/database');

const createLink = async (link) => {
  const query = `
    INSERT INTO links (id, code, owner_id)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;
  const values = [link.id, link.code, link.owner_id];
  const result = await pool.query(query, values);
  return result.rows[0];
};

const findByCode = async (code) => {
  const result = await pool.query('SELECT * FROM links WHERE code = $1 AND is_active = TRUE', [code]);
  return result.rows[0];
};

const findById = async (id) => {
  const result = await pool.query('SELECT * FROM links WHERE id = $1', [id]);
  return result.rows[0];
};

const findByOwner = async (ownerId) => {
  const result = await pool.query('SELECT * FROM links WHERE owner_id = $1 ORDER BY created_at DESC', [ownerId]);
  return result.rows;
};

const deactivateLink = async (id) => {
  const result = await pool.query('UPDATE links SET is_active = FALSE WHERE id = $1 RETURNING *', [id]);
  return result.rows[0];
};

module.exports = {
  createLink,
  findByCode,
  findById,
  findByOwner,
  deactivateLink,
};
