const pool = require('../../config/database');

const createUser = async (user) => {
  const query = `
    INSERT INTO users (id, anonymous_uid, pseudo, avatar_url)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const values = [user.id, user.anonymous_uid, user.pseudo, user.avatar_url];
  const result = await pool.query(query, values);
  return result.rows[0];
};

const findById = async (id) => {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
};

const findByAnonymousUid = async (anonymousUid) => {
  const result = await pool.query('SELECT * FROM users WHERE anonymous_uid = $1', [anonymousUid]);
  return result.rows[0];
};

const updateLastSeen = async (id) => {
  await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [id]);
};

const updatePseudoAndAvatar = async (id, pseudo, avatarUrl) => {
  const result = await pool.query(
    'UPDATE users SET pseudo = $1, avatar_url = $2 WHERE id = $3 RETURNING *',
    [pseudo, avatarUrl, id]
  );
  return result.rows[0];
};

const updateBio = async (id, bio) => {
  const result = await pool.query(
    'UPDATE users SET bio = $1 WHERE id = $2 RETURNING *',
    [bio, id]
  );
  return result.rows[0];
};

const updatePushToken = async (id, token) => {
  const result = await pool.query(
    'UPDATE users SET push_token = $1, push_updated_at = NOW() WHERE id = $2 RETURNING *',
    [token, id]
  );
  return result.rows[0];
};

module.exports = {
  createUser,
  findById,
  findByAnonymousUid,
  updateLastSeen,
  updatePseudoAndAvatar,
  updateBio,
  updatePushToken,
};
