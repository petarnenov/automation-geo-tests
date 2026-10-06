// @ts-check
/**
 * Load credentials from the repo-root `.env` / `.env.local` files into
 * process.env. Both files are gitignored (`.env*`); `.env.example` documents
 * the variables.
 *
 * Precedence: a variable already set in the shell wins, then `.env.local`,
 * then `.env`. Loading is idempotent and cheap, so every entry point
 * (playwright.config.js, helpers, scripts) can call it.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

/** @param {string} file */
function parseEnvFile(file) {
  /** @type {Record<string,string>} */
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

let loaded = false;

function loadEnv() {
  if (loaded) return;
  loaded = true;
  const fromFiles = {
    ...parseEnvFile(path.join(REPO_ROOT, '.env')),
    ...parseEnvFile(path.join(REPO_ROOT, '.env.local')),
  };
  for (const [key, value] of Object.entries(fromFiles)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in .env.local at the repo root (see .env.example) or export it.`
    );
  }
  return value;
}

module.exports = { loadEnv, requireEnv, REPO_ROOT };
