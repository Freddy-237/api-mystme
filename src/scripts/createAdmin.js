#!/usr/bin/env node
/**
 * Creates the FIRST back-office owner. Every other admin is then created from
 * the back-office itself (Équipe page).
 *
 *   node src/scripts/createAdmin.js --email you@example.com --name "Ton nom"
 *
 * Prints a temporary password once. At the first login the owner sets up a
 * two-factor app, then must replace the temporary password.
 * Refuses to run if an active owner already exists.
 */
const pool = require('../config/database');
const adminService = require('../modules/admin/admin.service');
const repo = require('../modules/admin/admin.repository');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

(async () => {
  const email = arg('email');
  const displayName = arg('name');
  if (!email || !displayName) {
    console.error('Usage: node src/scripts/createAdmin.js --email <email> --name "<nom>"');
    process.exitCode = 1;
    return;
  }
  try {
    const { admin, temporaryPassword } = await adminService.bootstrapOwner({ email, displayName });
    await repo.insertAudit({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'admin.bootstrapped',
      targetType: 'admin',
      targetId: admin.id,
      details: { via: 'createAdmin script' },
    });
    console.log('\nPropriétaire créé :', admin.email);
    console.log('Mot de passe temporaire (affiché une seule fois) :', temporaryPassword);
    console.log('À la première connexion : configuration de la double authentification, puis nouveau mot de passe.\n');
  } catch (error) {
    console.error('Échec :', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
