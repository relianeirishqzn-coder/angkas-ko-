// src/db.js
// Database layer for Angkas Ko, built entirely on Node's built-in `node:sqlite`
// module — no external dependencies required.
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { hashPassword } = require('./auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'angkasko.db');

const isFreshDb = !fs.existsSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'passenger' CHECK (role IN ('passenger','driver','admin')),
  wallet_balance REAL NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 5.0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  student_discount INTEGER NOT NULL DEFAULT 0,
  senior_mode INTEGER NOT NULL DEFAULT 0,
  emergency_alerts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('motor','tricycle','car')),
  plate_number TEXT NOT NULL,
  vehicle_desc TEXT NOT NULL,
  license_number TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('offline','online')),
  earnings_today REAL NOT NULL DEFAULT 0,
  completed_rides INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  passenger_id INTEGER NOT NULL REFERENCES users(id),
  driver_id INTEGER REFERENCES drivers(id),
  vehicle_type TEXT NOT NULL,
  pickup TEXT NOT NULL,
  destination TEXT NOT NULL,
  distance_km REAL NOT NULL,
  fare REAL NOT NULL,
  discount_applied TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','matched','ongoing','completed','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id INTEGER NOT NULL UNIQUE REFERENCES rides(id),
  stars INTEGER NOT NULL,
  tip REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sos_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id INTEGER REFERENCES rides(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(user_id);
`);

function insertUser({ name, phone, password, role = 'passenger', walletBalance = 0 }) {
  const { hash, salt } = hashPassword(password);
  const info = db.prepare(`
    INSERT INTO users (name, phone, password_hash, password_salt, role, wallet_balance)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, phone, hash, salt, role, walletBalance);
  return info.lastInsertRowid;
}

function seedIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return;

  console.log('Seeding demo data (first run)...');

  // Demo admin
  insertUser({ name: 'Admin', phone: '09990000000', password: 'admin123', role: 'admin' });

  // Demo passenger
  const passengerId = insertUser({
    name: 'Juan Dela Cruz',
    phone: '09171234567',
    password: 'passenger123',
    role: 'passenger',
    walletBalance: 320.5,
  });
  db.prepare('UPDATE users SET rating = 4.9, rating_count = 12 WHERE id = ?').run(passengerId);

  // Demo drivers — one per vehicle type, pre-verified and online so bookings
  // can be matched immediately out of the box.
  const demoDrivers = [
    { name: 'Kuya Ramon', phone: '09171111111', vehicle_type: 'motor', plate_number: 'ABC 1234', vehicle_desc: 'Honda Click 125i' },
    { name: 'Mang Tonyo', phone: '09172222222', vehicle_type: 'tricycle', plate_number: 'TRC 8821', vehicle_desc: 'Motorized Tricycle' },
    { name: 'Aling Baby', phone: '09173333333', vehicle_type: 'car', plate_number: 'CAR 5521', vehicle_desc: 'Toyota Vios' },
  ];
  for (const d of demoDrivers) {
    const uid = insertUser({ name: d.name, phone: d.phone, password: 'driver123', role: 'driver' });
    db.prepare('UPDATE users SET rating = 4.8, rating_count = 40 WHERE id = ?').run(uid);
    db.prepare(`
      INSERT INTO drivers (user_id, vehicle_type, plate_number, vehicle_desc, license_number, verified, status)
      VALUES (?, ?, ?, ?, ?, 1, 'online')
    `).run(uid, d.vehicle_type, d.plate_number, d.vehicle_desc, 'LIC-' + Math.floor(10000 + Math.random() * 89999));
  }

  console.log('Seed complete: admin / demo passenger / 3 demo drivers created.');
}

module.exports = { db, seedIfEmpty, insertUser, isFreshDb };
