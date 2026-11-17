const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const node = process.execPath;
const envPath = require('path').resolve(__dirname, '..');

function runEnvLoader(envVars) {
  return spawnSync(node, ['-e', "require('./src/config/env');"], {
    cwd: envPath,
    env: { ...process.env, ...envVars },
    encoding: 'utf8',
  });
}

test('production env validation rejects missing JWT_SECRET', () => {
  const result = runEnvLoader({
    NODE_ENV: 'production',
    JWT_SECRET: '',
    CORS_ORIGINS: 'https://example.com',
    CLOUDINARY_CLOUD_NAME: 'demo',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /JWT_SECRET is required in production/);
});

test('production env validation rejects missing CORS_ORIGINS', () => {
  const result = runEnvLoader({
    NODE_ENV: 'production',
    JWT_SECRET: 'supersecret',
    CORS_ORIGINS: '',
    CLOUDINARY_CLOUD_NAME: 'demo',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /CORS_ORIGINS is required in production/);
});

test('production env validation rejects missing Cloudinary credentials', () => {
  const result = runEnvLoader({
    NODE_ENV: 'production',
    JWT_SECRET: 'supersecret',
    CORS_ORIGINS: 'https://example.com',
    CLOUDINARY_CLOUD_NAME: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
    MODERATION_API_KEY: 'mod-key',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /CLOUDINARY_CLOUD_NAME is required in production/);
});

test('production env validation rejects missing DB_PASSWORD when DATABASE_URL is absent', () => {
  const result = runEnvLoader({
    NODE_ENV: 'production',
    JWT_SECRET: 'supersecret',
    CORS_ORIGINS: 'https://example.com',
    CLOUDINARY_CLOUD_NAME: 'demo',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
    MODERATION_API_KEY: 'mod-key',
    DB_HOST: 'localhost',
    DB_USER: 'postgres',
    DB_NAME: 'mystme',
    DB_PASSWORD: '',
    // CI exports DATABASE_URL, which would make DB_PASSWORD optional.
    DATABASE_URL: '',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /DB_PASSWORD is required in production/);
});

test('production env validation rejects missing MODERATION_API_KEY', () => {
  const result = runEnvLoader({
    NODE_ENV: 'production',
    JWT_SECRET: 'supersecret',
    CORS_ORIGINS: 'https://example.com',
    CLOUDINARY_CLOUD_NAME: 'demo',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
    DB_HOST: 'localhost',
    DB_USER: 'postgres',
    DB_NAME: 'mystme',
    DB_PASSWORD: 'password',
    MODERATION_API_KEY: '',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /MODERATION_API_KEY is required in production/);
});
