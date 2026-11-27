/**
 * Encrypted database backups, stored on Cloudinary.
 *
 * The Railway plan has no managed backups, so the API backs itself up:
 *   1. every table is exported as JSON by Postgres itself (json_agg), so
 *      values — timestamps included — round-trip exactly;
 *   2. the export is gzipped, then encrypted with AES-256-GCM;
 *   3. the file is uploaded to Cloudinary as a PRIVATE ("authenticated") raw
 *      resource under mystme/backups/; only the newest RETENTION are kept.
 *
 * Key: BACKUP_ENCRYPTION_KEY (any long random string). Without it, backups are
 * refused: a backup readable by anyone with Cloudinary access would be a leak.
 * Keep that key outside Railway too (password manager): it is the only way to
 * read a backup if the server is lost.
 */
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const pool = require('../config/database');
const logger = require('../utils/logger');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const FOLDER = 'mystme/backups';
const RETENTION = 14;
const FORMAT = 'mystme-backup-v1';
// Short-lived, regenerated data: not worth backing up.
const SKIPPED_TABLES = new Set(['distributed_rate_limits']);
const MAGIC = Buffer.from('MYSTBK1');

const backupKey = () => {
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) return null;
  return crypto.createHash('sha256').update(`mystme-backup:${secret}`).digest();
};

const isConfigured = () => !!backupKey();

const listTables = async (queryable = pool) => {
  const { rows } = await queryable.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name).filter((t) => !SKIPPED_TABLES.has(t));
};

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** Plain JS object holding every table's rows. */
const exportDatabase = async (queryable = pool) => {
  const tables = {};
  const counts = {};
  for (const table of await listTables(queryable)) {
    const { rows } = await queryable.query(
      `SELECT COALESCE(json_agg(t), '[]'::json)::text AS data FROM ${quote(table)} t`,
    );
    tables[table] = JSON.parse(rows[0].data);
    counts[table] = tables[table].length;
  }
  return { format: FORMAT, createdAt: new Date().toISOString(), counts, tables };
};

const encrypt = async (payload, key = backupKey()) => {
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY manquante (32 caractères minimum)');
  const plain = await gzip(Buffer.from(JSON.stringify(payload)));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
};

const decrypt = async (buffer, key = backupKey()) => {
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY manquante (32 caractères minimum)');
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Fichier de sauvegarde inconnu');
  let offset = MAGIC.length;
  const iv = buffer.subarray(offset, offset + 12); offset += 12;
  const tag = buffer.subarray(offset, offset + 16); offset += 16;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(buffer.subarray(offset)), decipher.final()]);
  const payload = JSON.parse((await gunzip(plain)).toString('utf8'));
  if (payload.format !== FORMAT) throw new Error('Format de sauvegarde non pris en charge');
  return payload;
};

/**
 * Replace the whole database content with a backup (one transaction).
 * Triggers and foreign keys are suspended during the load, so table order
 * does not matter and the append-only audit log can be reloaded.
 */
const restoreDatabase = async (payload, client) => {
  const current = new Set(await listTables(client));
  const tables = Object.keys(payload.tables).filter((t) => current.has(t));
  await client.query("SET LOCAL session_replication_role = 'replica'");
  await client.query(`TRUNCATE ${[...current].map(quote).join(', ')}`);
  for (const table of tables) {
    const rows = payload.tables[table];
    if (!rows.length) continue;
    await client.query(
      `INSERT INTO ${quote(table)} SELECT * FROM json_populate_recordset(NULL::${quote(table)}, $1::json)`,
      [JSON.stringify(rows)],
    );
  }
  return Object.fromEntries(tables.map((t) => [t, payload.tables[t].length]));
};

// ── Cloudinary storage ──────────────────────────────────────────────────────
const cloudinary = () => require('../config/cloudinary');

const upload = (buffer, publicId) => new Promise((resolve, reject) => {
  const stream = cloudinary().uploader.upload_stream(
    { resource_type: 'raw', type: 'authenticated', folder: FOLDER, public_id: publicId, overwrite: false },
    (error, result) => (error || !result ? reject(error || new Error('upload failed')) : resolve(result)),
  );
  stream.end(buffer);
});

const listBackups = async () => {
  const res = await cloudinary().api.resources({
    resource_type: 'raw', type: 'authenticated', prefix: `${FOLDER}/`, max_results: 100,
  });
  return (res.resources || [])
    .map((r) => ({ publicId: r.public_id, bytes: r.bytes, createdAt: r.created_at }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

/** Stored files are base64 text; raw encrypted bytes are accepted too. */
const fromStored = (buffer) => (
  buffer.subarray(0, MAGIC.length).equals(MAGIC)
    ? buffer
    : Buffer.from(buffer.toString('utf8').trim(), 'base64')
);

const downloadBackup = async (publicId) => {
  const url = cloudinary().utils.private_download_url(publicId, '', {
    resource_type: 'raw', type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + 300,
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement impossible (HTTP ${res.status})`);
  return fromStored(Buffer.from(await res.arrayBuffer()));
};

const pruneOldBackups = async () => {
  const old = (await listBackups()).slice(RETENTION);
  for (const b of old) {
    await cloudinary().uploader.destroy(b.publicId, { resource_type: 'raw', type: 'authenticated' });
  }
  return old.length;
};

/** Export, encrypt, upload, prune. Returns a short summary. */
const runBackup = async () => {
  const payload = await exportDatabase();
  const file = await encrypt(payload);
  const stamp = payload.createdAt.replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  // Cloudinary refuses raw uploads with "binary" extensions (.bin…): the
  // encrypted file is stored as base64 text in a .txt resource.
  const result = await upload(Buffer.from(file.toString('base64')), `db_${stamp}.txt`);
  const pruned = await pruneOldBackups();
  const summary = { publicId: result.public_id, bytes: file.length, rows: payload.counts, pruned };
  logger.info({ publicId: summary.publicId, bytes: summary.bytes, pruned }, 'database backup stored');
  return summary;
};

module.exports = {
  FORMAT,
  RETENTION,
  isConfigured,
  exportDatabase,
  encrypt,
  decrypt,
  fromStored,
  restoreDatabase,
  listBackups,
  downloadBackup,
  runBackup,
};
