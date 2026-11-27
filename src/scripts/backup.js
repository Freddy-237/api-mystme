#!/usr/bin/env node
/**
 * Database backups (run from the Railway console of the api-mystme service,
 * in /app, with /mise/installs/node/22.23.4/bin/node — or `npm run backup --`):
 *
 *   node src/scripts/backup.js now                    take a backup right away
 *   node src/scripts/backup.js list                   list stored backups
 *   node src/scripts/backup.js restore latest         show what would be restored
 *   node src/scripts/backup.js restore <id|latest> --confirm RESTAURER
 *        replace ALL current data with that backup (a backup of the current
 *        state is taken first, so a restore can itself be undone)
 *   node src/scripts/backup.js drop-old-schemas       list leftover reset_backup_* schemas
 *   node src/scripts/backup.js drop-old-schemas --confirm SUPPRIMER
 *        drop them (they hold personal data from before the reset)
 */
const pool = require('../config/database');
const backup = require('../services/backup.service');
const withTransaction = require('../utils/withTransaction');

const [command, target] = process.argv.slice(2);
const confirmIndex = process.argv.indexOf('--confirm');
const confirm = confirmIndex !== -1 ? process.argv[confirmIndex + 1] : null;

const requireKey = () => {
  if (!backup.isConfigured()) {
    throw new Error('BACKUP_ENCRYPTION_KEY absente ou trop courte (32 caractères minimum).');
  }
};

const commands = {
  async now() {
    requireKey();
    const s = await backup.runBackup();
    console.log(`Sauvegarde enregistrée : ${s.publicId} (${Math.round(s.bytes / 1024)} Ko)`);
    console.log('Lignes :', s.rows);
  },

  async list() {
    const items = await backup.listBackups();
    if (!items.length) return console.log('Aucune sauvegarde.');
    for (const b of items) console.log(`${b.createdAt}  ${String(Math.round(b.bytes / 1024)).padStart(6)} Ko  ${b.publicId}`);
  },

  async restore() {
    requireKey();
    const items = await backup.listBackups();
    const chosen = !target || target === 'latest' ? items[0] : items.find((b) => b.publicId === target);
    if (!chosen) throw new Error('Sauvegarde introuvable (voir : list).');
    const payload = await backup.decrypt(await backup.downloadBackup(chosen.publicId));
    console.log(`Sauvegarde ${chosen.publicId} du ${payload.createdAt}`);
    console.log('Contenu :', payload.counts);
    if (confirm !== 'RESTAURER') {
      console.log('\nSIMULATION : rien n\'a changé. Pour restaurer : --confirm RESTAURER');
      return;
    }
    const safety = await backup.runBackup();
    console.log(`État actuel sauvegardé d'abord : ${safety.publicId}`);
    const restored = await withTransaction((client) => backup.restoreDatabase(payload, client));
    console.log('Restauration terminée :', restored);
  },

  async 'drop-old-schemas'() {
    const { rows } = await pool.query(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'reset\\_backup\\_%' ORDER BY 1",
    );
    if (!rows.length) return console.log('Aucun schéma reset_backup_* à supprimer.');
    console.log('Schémas trouvés :', rows.map((r) => r.nspname).join(', '));
    if (confirm !== 'SUPPRIMER') {
      console.log('SIMULATION : rien n\'a été supprimé. Pour supprimer : --confirm SUPPRIMER');
      return;
    }
    for (const { nspname } of rows) {
      await pool.query(`DROP SCHEMA "${nspname.replace(/"/g, '""')}" CASCADE`);
      console.log(`Supprimé : ${nspname}`);
    }
  },
};

(async () => {
  const run = commands[command];
  if (!run) {
    console.log('Commandes : now | list | restore <id|latest> [--confirm RESTAURER] | drop-old-schemas [--confirm SUPPRIMER]');
    process.exitCode = 1;
  } else {
    try {
      await run();
    } catch (error) {
      console.error('Échec :', error.message);
      process.exitCode = 1;
    }
  }
  await pool.end();
})();
