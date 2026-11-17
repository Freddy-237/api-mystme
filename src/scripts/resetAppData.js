#!/usr/bin/env node
/**
 * Resets MystMe to a brand-new app: erases every user-side row (identities,
 * links, conversations, messages, reports, bans, subscriptions, OTPs, transfer
 * codes, rate-limit counters) and, optionally, the message media on Cloudinary.
 *
 * KEPT: back-office accounts, their sessions, the audit log, and the
 * migration history. The reset itself is written to the audit log.
 *
 * BACKUP: unless --no-backup is given, every erased table is first copied,
 * in the same transaction, into a schema named reset_backup_<date> in the same
 * database. Nothing leaves Railway; restoring is a matter of SQL. Cloudinary
 * media deleted with --with-media cannot be restored.
 *
 * Without --confirm it only prints what WOULD be erased (dry run):
 *   node src/scripts/resetAppData.js
 *
 * To actually erase (irreversible):
 *   node src/scripts/resetAppData.js --confirm EFFACER-TOUT [--with-media]
 */
const pool = require('../config/database');

const KEEP = new Set(['schema_migrations', 'admin_users', 'admin_sessions', 'admin_audit_log']);
const CONFIRM_WORD = 'EFFACER-TOUT';
const MEDIA_PREFIX = 'mystme/messages/';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? (process.argv[i + 1] || true) : undefined;
};

const listAppTables = async (client) => {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name).filter((t) => !KEEP.has(t));
};

const countRows = async (client, tables) => {
  const out = {};
  for (const t of tables) {
    // Table names come from information_schema, quoted as identifiers.
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM "${t.replace(/"/g, '""')}"`);
    out[t] = rows[0].n;
  }
  return out;
};

const deleteMedia = async () => {
  // Required lazily: the dry run must work even without Cloudinary credentials.
  const cloudinary = require('../config/cloudinary');
  const deleted = {};
  for (const resourceType of ['image', 'video', 'raw']) {
    let total = 0;
    // Cloudinary deletes at most 1000 resources per call and reports `partial`.
    for (let round = 0; round < 100; round += 1) {
      const res = await cloudinary.api.delete_resources_by_prefix(MEDIA_PREFIX, { resource_type: resourceType });
      total += Object.keys(res.deleted || {}).length;
      if (!res.partial) break;
    }
    deleted[resourceType] = total;
  }
  return deleted;
};

(async () => {
  const confirmed = arg('confirm') === CONFIRM_WORD;
  const withMedia = arg('with-media') !== undefined;
  const withBackup = arg('no-backup') === undefined;
  const backupSchema = `reset_backup_${new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15)}`;
  const client = await pool.connect();
  let exitCode = 0;
  try {
    const tables = await listAppTables(client);
    const before = await countRows(client, tables);
    const owners = await client.query("SELECT COUNT(*)::int AS n FROM admin_users WHERE role = 'owner' AND is_active");

    console.log('\nTables effacées :');
    for (const t of tables) console.log(`  ${t.padEnd(28)} ${before[t]} lignes`);
    console.log(`Conservé : ${[...KEEP].join(', ')} (${owners.rows[0].n} propriétaire(s) actif(s))`);
    console.log(`Médias Cloudinary (${MEDIA_PREFIX}) : ${withMedia ? 'effacés' : 'conservés'}`);
    console.log(`Sauvegarde : ${withBackup ? `copie dans le schéma ${backupSchema}` : 'AUCUNE'}`);

    if (!confirmed) {
      console.log(`\nSIMULATION : rien n'a été effacé. Pour effacer : --confirm ${CONFIRM_WORD}${withMedia ? ' --with-media' : ''}\n`);
      return;
    }
    if (owners.rows[0].n === 0) {
      throw new Error('Aucun propriétaire actif dans le back-office : crée-le avant de remettre à zéro.');
    }

    await client.query('BEGIN');
    if (withBackup) {
      await client.query(`CREATE SCHEMA "${backupSchema}"`);
      for (const t of tables) {
        const q = `"${t.replace(/"/g, '""')}"`;
        await client.query(`CREATE TABLE "${backupSchema}".${q} AS TABLE public.${q}`);
      }
    }
    // One statement for all tables: Postgres accepts the foreign keys between
    // them, and refuses (rather than silently cascades) if a kept table
    // depended on one of them.
    await client.query(`TRUNCATE ${tables.map((t) => `"${t.replace(/"/g, '""')}"`).join(', ')} RESTART IDENTITY`);
    await client.query(
      `INSERT INTO admin_audit_log (admin_id, admin_email, action, target_type, target_id, details)
       VALUES (NULL, NULL, 'system.reset', 'database', NULL, $1::jsonb)`,
      [JSON.stringify({ rowsErased: before, withMedia, backupSchema: withBackup ? backupSchema : null, via: 'resetAppData script' })],
    );
    await client.query('COMMIT');
    console.log('\nBase remise à zéro.');
    if (withBackup) console.log(`Sauvegarde conservée dans le schéma ${backupSchema}.`);

    if (withMedia) {
      const deleted = await deleteMedia();
      console.log('Médias supprimés sur Cloudinary :', deleted);
    }

    const after = await countRows(client, tables);
    const left = Object.entries(after).filter(([, n]) => n > 0);
    console.log(left.length ? `Attention, lignes restantes : ${JSON.stringify(after)}` : 'Vérification : toutes les tables sont vides.');
    console.log('');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Échec :', error.message);
    exitCode = 1;
  } finally {
    client.release();
    await pool.end();
    process.exitCode = exitCode;
  }
})();
