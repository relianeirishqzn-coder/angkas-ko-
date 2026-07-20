#!/usr/bin/env node
// scripts/backup.js
//
// Creates a safe, point-in-time snapshot of the live SQLite database using
// `VACUUM INTO`, which is safe to run while the server is up and writing
// (unlike copying the .db file directly, which can grab a half-written page
// under WAL mode and hand you a corrupt backup).
//
// Usage:
//   node scripts/backup.js                 # one-off backup
//   npm run backup                         # same, via package.json
//
// Suggested cron entry for a nightly backup at 2am, keeping the last 14:
//   0 2 * * * cd /path/to/angkasko-fullstack && /usr/bin/node scripts/backup.js >> backups/backup.log 2>&1
//
// For continuous (near-zero data loss) backups instead of nightly snapshots,
// see the Litestream section in README.md — it streams every change to S3 /
// a similar bucket as it happens, rather than snapshotting once a day.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DRIVER = (process.env.DB_DRIVER || 'sqlite').toLowerCase();
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'angkasko.db');
const SECRET_PATH = path.join(DATA_DIR, '.session-secret');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const KEEP_LAST = Number(process.env.BACKUP_KEEP_LAST || 14);

function main() {
  if (DRIVER !== 'sqlite') {
    console.log(
      `DB_DRIVER is set to "${DRIVER}" — this script only backs up the local SQLite file.\n` +
      'When using Postgres, use your database provider\'s own backup/point-in-time-recovery ' +
      'feature instead (e.g. managed automated backups on Render/RDS/Supabase, or pg_dump on a VPS).'
    );
    return;
  }

  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database found at ${DB_PATH} — nothing to back up yet.`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dbBackupPath = path.join(BACKUP_DIR, `angkasko-${stamp}.db`);

  const db = new DatabaseSync(DB_PATH);
  try {
    // VACUUM INTO takes an atomic, consistent snapshot — safe to run against
    // a live database, unlike a raw file copy.
    db.exec(`VACUUM INTO '${dbBackupPath.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  console.log(`✔ Database backed up to ${dbBackupPath}`);

  // The session secret isn't sensitive the way the database is, but it MUST
  // travel with your backups — see src/auth.js for why. We snapshot it
  // alongside each backup so a restore always has a matching pair.
  if (fs.existsSync(SECRET_PATH)) {
    const secretBackupPath = path.join(BACKUP_DIR, `session-secret-${stamp}.txt`);
    fs.copyFileSync(SECRET_PATH, secretBackupPath);
    fs.chmodSync(secretBackupPath, 0o600);
    console.log(`✔ Session secret backed up to ${secretBackupPath}`);
  } else {
    console.log('ℹ No data/.session-secret file found (SESSION_SECRET is probably set via env) — skipped.');
  }

  rotateOldBackups();
}

function rotateOldBackups() {
  const entries = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('angkasko-') && f.endsWith('.db'))
    .map((f) => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  const toDelete = entries.slice(KEEP_LAST);
  for (const entry of toDelete) {
    const stamp = entry.name.replace(/^angkasko-/, '').replace(/\.db$/, '');
    for (const prefix of ['angkasko-', 'session-secret-']) {
      const ext = prefix === 'angkasko-' ? '.db' : '.txt';
      const p = path.join(BACKUP_DIR, `${prefix}${stamp}${ext}`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
  if (toDelete.length > 0) {
    console.log(`🧹 Removed ${toDelete.length} backup(s) older than the last ${KEEP_LAST}.`);
  }
}

main();
