const pool = require('../../config/database');

const q = (queryable, text, values) => (queryable || pool).query(text, values);

const ADMIN_PUBLIC_COLUMNS = `id, email, display_name, role, must_change_password,
  (totp_secret_enc IS NOT NULL) AS totp_enabled, is_active, last_login_at, created_at`;

// ── Admin accounts ──────────────────────────────────────────────────────────
const findByEmail = async (email, queryable) => {
  const r = await q(queryable, 'SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked FROM admin_users WHERE LOWER(email) = LOWER($1)', [email]);
  return r.rows[0] || null;
};

const findById = async (id, queryable) => {
  const r = await q(queryable, 'SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked FROM admin_users WHERE id = $1', [id]);
  return r.rows[0] || null;
};

const findPublicById = async (id, queryable) => {
  const r = await q(queryable, `SELECT ${ADMIN_PUBLIC_COLUMNS} FROM admin_users WHERE id = $1`, [id]);
  return r.rows[0] || null;
};

const listAdmins = async (queryable) => {
  const r = await q(queryable, `SELECT ${ADMIN_PUBLIC_COLUMNS} FROM admin_users ORDER BY created_at ASC`);
  return r.rows;
};

const countActiveOwners = async (queryable) => {
  const r = await q(queryable, "SELECT COUNT(*)::int AS n FROM admin_users WHERE role = 'owner' AND is_active");
  return r.rows[0].n;
};

const createAdmin = async ({ id, email, displayName, role, passwordHash }, queryable) => {
  const r = await q(
    queryable,
    `INSERT INTO admin_users (id, email, display_name, role, password_hash, must_change_password)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING ${ADMIN_PUBLIC_COLUMNS}`,
    [id, email, displayName, role, passwordHash],
  );
  return r.rows[0];
};

const updateAdmin = async (id, fields, queryable) => {
  const allowed = {
    role: 'role',
    isActive: 'is_active',
    displayName: 'display_name',
  };
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (fields[key] !== undefined) {
      values.push(fields[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (!sets.length) return findPublicById(id, queryable);
  values.push(id);
  const r = await q(
    queryable,
    `UPDATE admin_users SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING ${ADMIN_PUBLIC_COLUMNS}`,
    values,
  );
  return r.rows[0] || null;
};

const recordFailedLogin = async (id, { maxAttempts, lockMinutes }, queryable) => {
  await q(
    queryable,
    `UPDATE admin_users
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE WHEN failed_login_count + 1 >= $2
                                THEN NOW() + ($3 || ' minutes')::interval
                                ELSE locked_until END,
            updated_at = NOW()
      WHERE id = $1`,
    [id, maxAttempts, String(lockMinutes)],
  );
};

const resetFailedLogins = async (id, queryable) => {
  await q(
    queryable,
    'UPDATE admin_users SET failed_login_count = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1',
    [id],
  );
};

const setPendingTotp = async (id, pendingEnc, queryable) => {
  await q(queryable, 'UPDATE admin_users SET totp_pending_enc = $2, updated_at = NOW() WHERE id = $1', [id, pendingEnc]);
};

const confirmTotp = async (id, { secretEnc, step }, queryable) => {
  await q(
    queryable,
    `UPDATE admin_users
        SET totp_secret_enc = $2, totp_pending_enc = NULL, totp_last_step = $3,
            failed_login_count = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [id, secretEnc, step],
  );
};

const recordTotpLogin = async (id, step, queryable) => {
  await q(
    queryable,
    `UPDATE admin_users
        SET totp_last_step = $2, failed_login_count = 0, locked_until = NULL,
            last_login_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [id, step],
  );
};

const setPassword = async (id, { passwordHash, mustChange }, queryable) => {
  await q(
    queryable,
    `UPDATE admin_users
        SET password_hash = $2, must_change_password = $3, updated_at = NOW()
      WHERE id = $1`,
    [id, passwordHash, mustChange],
  );
};

const resetTwoFactor = async (id, queryable) => {
  await q(
    queryable,
    `UPDATE admin_users
        SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_last_step = NULL,
            failed_login_count = 0, locked_until = NULL, updated_at = NOW()
      WHERE id = $1`,
    [id],
  );
};

// ── Sessions ────────────────────────────────────────────────────────────────
// Timestamps are computed by Postgres (columns are TIMESTAMP without zone,
// so mixing in JS dates would shift them by the server's UTC offset).
const createSession = async ({ id, adminId, tokenHash, ip, userAgent, ttlMs }, queryable) => {
  await q(
    queryable,
    `INSERT INTO admin_sessions (id, admin_id, token_hash, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6::bigint * INTERVAL '1 millisecond'))`,
    [id, adminId, tokenHash, ip, userAgent, ttlMs],
  );
};

const findActiveSession = async (tokenHash, queryable) => {
  const r = await q(
    queryable,
    `SELECT s.id AS session_id, s.last_seen_at, s.expires_at,
            EXTRACT(EPOCH FROM (NOW() - s.last_seen_at))::int AS idle_seconds,
            a.id, a.email, a.display_name, a.role, a.must_change_password, a.is_active
       FROM admin_sessions s
       JOIN admin_users a ON a.id = s.admin_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()`,
    [tokenHash],
  );
  return r.rows[0] || null;
};

const touchSession = async (sessionId, queryable) => {
  await q(queryable, 'UPDATE admin_sessions SET last_seen_at = NOW() WHERE id = $1', [sessionId]);
};

const revokeSession = async (sessionId, queryable) => {
  await q(queryable, 'UPDATE admin_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
};

const revokeAllSessions = async (adminId, { exceptSessionId = null } = {}, queryable) => {
  await q(
    queryable,
    `UPDATE admin_sessions SET revoked_at = NOW()
      WHERE admin_id = $1 AND revoked_at IS NULL
        AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [adminId, exceptSessionId],
  );
};

// ── Audit log ───────────────────────────────────────────────────────────────
const insertAudit = async ({ adminId, adminEmail, action, targetType, targetId, details, ip }, queryable) => {
  await q(
    queryable,
    `INSERT INTO admin_audit_log (admin_id, admin_email, action, target_type, target_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [adminId || null, adminEmail || null, action, targetType || null, targetId || null, JSON.stringify(details || {}), ip || null],
  );
};

const listAudit = async ({ limit = 50, beforeId = null, adminId = null } = {}, queryable) => {
  const r = await q(
    queryable,
    `SELECT id::text, admin_id, admin_email, action, target_type, target_id, details, ip, created_at
       FROM admin_audit_log
      WHERE ($1::bigint IS NULL OR admin_audit_log.id < $1::bigint)
        AND ($2::uuid IS NULL OR admin_id = $2::uuid)
      -- Qualified: the selected "id" is cast to text, and ordering by it would sort "99" after "212".
      ORDER BY admin_audit_log.id DESC
      LIMIT $3`,
    [beforeId, adminId, Math.max(1, Math.min(Number(limit) || 50, 200))],
  );
  return r.rows;
};

module.exports = {
  findByEmail,
  findById,
  findPublicById,
  listAdmins,
  countActiveOwners,
  createAdmin,
  updateAdmin,
  recordFailedLogin,
  resetFailedLogins,
  setPendingTotp,
  confirmTotp,
  recordTotpLogin,
  setPassword,
  resetTwoFactor,
  createSession,
  findActiveSession,
  touchSession,
  revokeSession,
  revokeAllSessions,
  insertAudit,
  listAudit,
};
