// src/api.js
'use strict';

const { dbGet, dbAll, dbRun, seedIfEmpty } = require('./db');
const { hashPassword, verifyPassword, signSession, verifySession } = require('./auth');
const { readJsonBody, parseCookies, sendJson, setSessionCookie, clearSessionCookie } = require('./http-utils');
const { computeFare } = require('./fare');
const payments = require('./payments');

const seedPromise = seedIfEmpty().catch((e) => {
  console.error('Failed to seed demo data:', e);
});

const PLATFORM_COMMISSION = 0.15; // Angkas Ko keeps 15%, matches the proposal's revenue model

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.role,
    walletBalance: round2(u.wallet_balance),
    rating: u.rating,
    ratingCount: u.rating_count,
    studentDiscount: !!u.student_discount,
    seniorMode: !!u.senior_mode,
    emergencyAlerts: !!u.emergency_alerts,
    createdAt: u.created_at,
  };
}

async function getUserById(id) {
  return dbGet('SELECT * FROM users WHERE id = ?', [id]);
}

async function getUserFromRequest(req) {
  const cookies = parseCookies(req);
  const session = verifySession(cookies.ak_session);
  if (!session) return null;
  return getUserById(session.uid);
}

async function getDriverByUserId(userId) {
  return dbGet('SELECT * FROM drivers WHERE user_id = ?', [userId]);
}

async function getDriverById(id) {
  return dbGet('SELECT * FROM drivers WHERE id = ?', [id]);
}

function driverPublic(d, driverUser) {
  if (!d) return null;
  return {
    id: d.id,
    name: driverUser ? driverUser.name : null,
    vehicleType: d.vehicle_type,
    plateNumber: d.plate_number,
    vehicleDesc: d.vehicle_desc,
    verified: !!d.verified,
    status: d.status,
    rating: driverUser ? driverUser.rating : null,
    completedRides: d.completed_rides,
  };
}

async function getRide(id) {
  return dbGet('SELECT * FROM rides WHERE id = ?', [id]);
}

async function ridePublic(r) {
  let driver = null;
  if (r.driver_id) {
    const d = await getDriverById(r.driver_id);
    const du = d ? await getUserById(d.user_id) : null;
    driver = driverPublic(d, du);
  }
  const rating = await dbGet('SELECT * FROM ratings WHERE ride_id = ?', [r.id]);
  return {
    id: r.id,
    vehicleType: r.vehicle_type,
    pickup: r.pickup,
    destination: r.destination,
    distanceKm: r.distance_km,
    fare: r.fare,
    discountApplied: r.discount_applied,
    status: r.status,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    driver,
    rating: rating ? { stars: rating.stars, tip: rating.tip } : null,
  };
}

async function ridesPublic(rows) {
  return Promise.all(rows.map(ridePublic));
}

// ---------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------

const routes = [];
function route(method, pattern, handler, { auth = false, role = null } = {}) {
  const paramNames = [];
  const regex = new RegExp(
    '^' +
      pattern
        .split('/')
        .map((seg) => {
          if (seg.startsWith(':')) {
            paramNames.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/') +
      '$'
  );
  routes.push({ method, regex, paramNames, handler, auth, role });
}

// ---------------- AUTH ----------------

route('POST', '/api/auth/register', async (req, res, ctx) => {
  const { name, phone, password, role, vehicleType, plateNumber, vehicleDesc } = ctx.body;
  if (!name || !phone || !password) {
    return sendJson(res, 400, { error: 'name, phone, and password are required' });
  }
  if (String(password).length < 6) {
    return sendJson(res, 400, { error: 'Password must be at least 6 characters' });
  }
  const normPhone = normalizePhone(phone);
  const existing = await dbGet('SELECT id FROM users WHERE phone = ?', [normPhone]);
  if (existing) {
    return sendJson(res, 409, { error: 'An account with this phone number already exists' });
  }
  const finalRole = role === 'driver' ? 'driver' : 'passenger';
  const { hash, salt } = hashPassword(password);
  const info = await dbRun(
    `INSERT INTO users (name, phone, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)`,
    [name, normPhone, hash, salt, finalRole]
  );
  const userId = info.lastInsertRowid;

  if (finalRole === 'driver') {
    if (!vehicleType || !plateNumber) {
      return sendJson(res, 400, { error: 'Drivers must provide vehicleType and plateNumber' });
    }
    await dbRun(
      `INSERT INTO drivers (user_id, vehicle_type, plate_number, vehicle_desc, verified, status)
       VALUES (?, ?, ?, ?, 0, 'offline')`,
      [userId, vehicleType, plateNumber, vehicleDesc || '']
    );
  }

  const token = signSession({ uid: userId });
  setSessionCookie(res, token);
  const user = await getUserById(userId);
  sendJson(res, 201, { user: publicUser(user) });
});

route('POST', '/api/auth/login', async (req, res, ctx) => {
  const { phone, password } = ctx.body;
  const normPhone = normalizePhone(phone);
  const user = await dbGet('SELECT * FROM users WHERE phone = ?', [normPhone]);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    return sendJson(res, 401, { error: 'Invalid phone number or password' });
  }
  const token = signSession({ uid: user.id });
  setSessionCookie(res, token);
  sendJson(res, 200, { user: publicUser(user) });
});

route('POST', '/api/auth/logout', async (req, res) => {
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/auth/me', async (req, res, ctx) => {
  sendJson(res, 200, { user: publicUser(ctx.user) });
}, { auth: true });

// ---------------- USER SETTINGS ----------------

route('POST', '/api/user/settings', async (req, res, ctx) => {
  const { studentDiscount, seniorMode, emergencyAlerts } = ctx.body;
  await dbRun(
    `UPDATE users SET student_discount = ?, senior_mode = ?, emergency_alerts = ? WHERE id = ?`,
    [studentDiscount ? 1 : 0, seniorMode ? 1 : 0, emergencyAlerts === false ? 0 : 1, ctx.user.id]
  );
  sendJson(res, 200, { user: publicUser(await getUserById(ctx.user.id)) });
}, { auth: true });

// ---------------- FARE QUOTE ----------------

route('POST', '/api/fare/quote', async (req, res, ctx) => {
  const { vehicleType, destination } = ctx.body;
  try {
    const quote = computeFare({
      vehicleType,
      destination,
      studentDiscount: ctx.user.student_discount,
      seniorMode: ctx.user.senior_mode,
    });
    sendJson(res, 200, quote);
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
}, { auth: true });

// ---------------- RIDES ----------------

route('POST', '/api/rides', async (req, res, ctx) => {
  const { vehicleType, pickup, destination } = ctx.body;
  if (!vehicleType || !destination) {
    return sendJson(res, 400, { error: 'vehicleType and destination are required' });
  }
  let quote;
  try {
    quote = computeFare({
      vehicleType,
      destination,
      studentDiscount: ctx.user.student_discount,
      seniorMode: ctx.user.senior_mode,
    });
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }

  // Find an available online driver of the matching vehicle type that
  // isn't already on an active ride.
  const candidate = await dbGet(
    `SELECT d.* FROM drivers d
     WHERE d.vehicle_type = ?
       AND d.status = 'online'
       AND d.id NOT IN (
         SELECT driver_id FROM rides WHERE status IN ('matched','ongoing') AND driver_id IS NOT NULL
       )
     ORDER BY RANDOM() LIMIT 1`,
    [vehicleType]
  );

  const status = candidate ? 'matched' : 'requested';
  const info = await dbRun(
    `INSERT INTO rides (passenger_id, driver_id, vehicle_type, pickup, destination, distance_km, fare, discount_applied, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ctx.user.id,
      candidate ? candidate.id : null,
      vehicleType,
      pickup || 'Current Location',
      destination,
      quote.distanceKm,
      quote.fare,
      quote.discountApplied,
      status,
    ]
  );

  const ride = await getRide(info.lastInsertRowid);
  sendJson(res, 201, { ride: await ridePublic(ride), eta: quote.etaMin });
}, { auth: true });

route('GET', '/api/rides', async (req, res, ctx) => {
  const rides = await dbAll(
    'SELECT * FROM rides WHERE passenger_id = ? ORDER BY created_at DESC LIMIT 30',
    [ctx.user.id]
  );
  sendJson(res, 200, { rides: await ridesPublic(rides) });
}, { auth: true });

route('GET', '/api/rides/:id', async (req, res, ctx) => {
  const ride = await getRide(ctx.params.id);
  if (!ride || ride.passenger_id !== ctx.user.id) {
    return sendJson(res, 404, { error: 'Ride not found' });
  }
  sendJson(res, 200, { ride: await ridePublic(ride) });
}, { auth: true });

route('POST', '/api/rides/:id/start', async (req, res, ctx) => {
  const ride = await getRide(ctx.params.id);
  if (!ride || ride.passenger_id !== ctx.user.id) return sendJson(res, 404, { error: 'Ride not found' });
  if (ride.status !== 'matched') return sendJson(res, 400, { error: `Cannot start a ride in status "${ride.status}"` });
  await dbRun("UPDATE rides SET status = 'ongoing' WHERE id = ?", [ride.id]);
  sendJson(res, 200, { ride: await ridePublic(await getRide(ride.id)) });
}, { auth: true });

route('POST', '/api/rides/:id/complete', async (req, res, ctx) => {
  const ride = await getRide(ctx.params.id);
  if (!ride || ride.passenger_id !== ctx.user.id) return sendJson(res, 404, { error: 'Ride not found' });
  if (!['matched', 'ongoing'].includes(ride.status)) {
    return sendJson(res, 400, { error: `Cannot complete a ride in status "${ride.status}"` });
  }

  await dbRun("UPDATE rides SET status = 'completed', completed_at = {{NOW}} WHERE id = ?", [ride.id]);

  // Passenger pays fare from wallet (floored at 0 for this demo — a real
  // deployment would block booking with insufficient balance instead).
  const passenger = await getUserById(ctx.user.id);
  const newBalance = round2(Math.max(0, passenger.wallet_balance - ride.fare));
  await dbRun('UPDATE users SET wallet_balance = ? WHERE id = ?', [newBalance, ctx.user.id]);
  await dbRun(
    `INSERT INTO wallet_transactions (user_id, type, amount, note) VALUES (?, 'fare', ?, ?)`,
    [ctx.user.id, -ride.fare, `Ride #${ride.id} — ${ride.pickup} to ${ride.destination}`]
  );

  // Driver earns fare minus the platform commission, and becomes available again.
  if (ride.driver_id) {
    const driver = await getDriverById(ride.driver_id);
    const earning = round2(ride.fare * (1 - PLATFORM_COMMISSION));
    await dbRun(
      `UPDATE drivers SET earnings_today = earnings_today + ?, completed_rides = completed_rides + 1 WHERE id = ?`,
      [earning, driver.id]
    );
    await dbRun('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [earning, driver.user_id]);
    await dbRun(
      `INSERT INTO wallet_transactions (user_id, type, amount, note) VALUES (?, 'ride_earning', ?, ?)`,
      [driver.user_id, earning, `Ride #${ride.id} earning (after 15% platform fee)`]
    );
  }

  sendJson(res, 200, { ride: await ridePublic(await getRide(ride.id)), walletBalance: newBalance });
}, { auth: true });

route('POST', '/api/rides/:id/rate', async (req, res, ctx) => {
  const ride = await getRide(ctx.params.id);
  if (!ride || ride.passenger_id !== ctx.user.id) return sendJson(res, 404, { error: 'Ride not found' });
  if (ride.status !== 'completed') return sendJson(res, 400, { error: 'Only completed rides can be rated' });
  const already = await dbGet('SELECT id FROM ratings WHERE ride_id = ?', [ride.id]);
  if (already) return sendJson(res, 409, { error: 'This ride has already been rated' });

  let { stars, tip } = ctx.body;
  stars = Math.max(1, Math.min(5, Math.round(Number(stars) || 5)));
  tip = Math.max(0, Number(tip) || 0);

  await dbRun('INSERT INTO ratings (ride_id, stars, tip) VALUES (?, ?, ?)', [ride.id, stars, tip]);

  if (ride.driver_id) {
    const driver = await getDriverById(ride.driver_id);
    const driverUser = await getUserById(driver.user_id);
    const newCount = driverUser.rating_count + 1;
    const newRating = (driverUser.rating * driverUser.rating_count + stars) / newCount;
    await dbRun('UPDATE users SET rating = ?, rating_count = ? WHERE id = ?', [round2(newRating), newCount, driverUser.id]);

    if (tip > 0) {
      const passenger = await getUserById(ctx.user.id);
      const newBalance = round2(Math.max(0, passenger.wallet_balance - tip));
      await dbRun('UPDATE users SET wallet_balance = ? WHERE id = ?', [newBalance, ctx.user.id]);
      await dbRun(
        `INSERT INTO wallet_transactions (user_id, type, amount, note) VALUES (?, 'tip', ?, ?)`,
        [ctx.user.id, -tip, `Tip for ride #${ride.id}`]
      );
      await dbRun('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [tip, driver.user_id]);
      await dbRun('UPDATE drivers SET earnings_today = earnings_today + ? WHERE id = ?', [tip, driver.id]);
      await dbRun(
        `INSERT INTO wallet_transactions (user_id, type, amount, note) VALUES (?, 'tip_earning', ?, ?)`,
        [driver.user_id, tip, `Tip received for ride #${ride.id}`]
      );
    }
  }

  sendJson(res, 200, { ride: await ridePublic(await getRide(ride.id)) });
}, { auth: true });

route('POST', '/api/rides/:id/sos', async (req, res, ctx) => {
  const ride = await getRide(ctx.params.id);
  if (!ride || ride.passenger_id !== ctx.user.id) return sendJson(res, 404, { error: 'Ride not found' });
  await dbRun(
    'INSERT INTO sos_alerts (ride_id, user_id, note) VALUES (?, ?, ?)',
    [ride.id, ctx.user.id, ctx.body.note || 'SOS triggered from live ride tracking']
  );
  sendJson(res, 200, {
    ok: true,
    message: ctx.user.emergency_alerts
      ? 'SOS sent — Angkas Ko safety support and your emergency contacts have been notified.'
      : 'SOS sent to Angkas Ko safety support. Turn on Emergency Contact Alerts in your profile to also notify family.',
  });
}, { auth: true });

route('POST', '/api/rides/:id/cancel', async (req, res, ctx) => {
  const ride = await getRide(ctx.params.id);
  if (!ride || ride.passenger_id !== ctx.user.id) return sendJson(res, 404, { error: 'Ride not found' });
  if (!['requested', 'matched'].includes(ride.status)) {
    return sendJson(res, 400, { error: `Cannot cancel a ride in status "${ride.status}"` });
  }
  await dbRun("UPDATE rides SET status = 'cancelled' WHERE id = ?", [ride.id]);
  sendJson(res, 200, { ride: await ridePublic(await getRide(ride.id)) });
}, { auth: true });

// ---------------- PUBLIC CONFIG ----------------

route('GET', '/api/config', async (req, res) => {
  sendJson(res, 200, { paymentIsDemo: payments.isDemoMode(), paymentProvider: payments.currentProvider });
});

// ---------------- WALLET ----------------

route('GET', '/api/wallet', async (req, res, ctx) => {
  const user = await getUserById(ctx.user.id);
  const transactions = await dbAll(
    'SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    [ctx.user.id]
  );
  sendJson(res, 200, { balance: round2(user.wallet_balance), transactions });
}, { auth: true });

route('POST', '/api/wallet/topup', async (req, res, ctx) => {
  let { amount } = ctx.body;
  amount = Number(amount);
  if (!amount || amount <= 0 || amount > 10000) {
    return sendJson(res, 400, { error: 'Enter a valid amount between ₱1 and ₱10,000' });
  }

  // Every top-up goes through the payments module, regardless of provider.
  // The "mock" provider (default) credits instantly with no real money
  // moving — see PAYMENT_INTEGRATION.md before switching this for a launch.
  let result;
  try {
    result = await payments.processTopUp({ userId: ctx.user.id, amount, phone: ctx.user.phone });
  } catch (e) {
    return sendJson(res, e.status || 500, { error: e.message });
  }

  if (result.status !== 'completed') {
    // A real gateway might come back "pending" (e.g. waiting on a redirect
    // or webhook) rather than completing synchronously.
    return sendJson(res, 202, { status: result.status, message: result.message });
  }

  await dbRun('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [amount, ctx.user.id]);
  await dbRun(
    `INSERT INTO wallet_transactions (user_id, type, amount, note) VALUES (?, 'topup', ?, ?)`,
    [ctx.user.id, amount, `${result.message} (ref: ${result.providerRef})`]
  );
  const user = await getUserById(ctx.user.id);
  sendJson(res, 200, {
    balance: round2(user.wallet_balance),
    isDemo: !!result.isDemo,
    message: result.message,
  });
}, { auth: true });

// ---------------- DRIVER ----------------

route('GET', '/api/driver/me', async (req, res, ctx) => {
  const driver = await getDriverByUserId(ctx.user.id);
  if (!driver) return sendJson(res, 404, { error: 'No driver profile for this account' });
  sendJson(res, 200, { driver: driverPublic(driver, ctx.user) });
}, { auth: true, role: 'driver' });

route('POST', '/api/driver/status', async (req, res, ctx) => {
  const driver = await getDriverByUserId(ctx.user.id);
  if (!driver) return sendJson(res, 404, { error: 'No driver profile for this account' });
  const online = !!ctx.body.online;
  await dbRun('UPDATE drivers SET status = ? WHERE id = ?', [online ? 'online' : 'offline', driver.id]);
  sendJson(res, 200, { driver: driverPublic(await getDriverByUserId(ctx.user.id), ctx.user) });
}, { auth: true, role: 'driver' });

route('GET', '/api/driver/requests', async (req, res, ctx) => {
  const driver = await getDriverByUserId(ctx.user.id);
  if (!driver) return sendJson(res, 404, { error: 'No driver profile for this account' });
  const requests = await dbAll(
    `SELECT r.*, u.name AS passenger_name FROM rides r
     JOIN users u ON u.id = r.passenger_id
     WHERE r.status = 'requested' AND r.vehicle_type = ?
     ORDER BY r.created_at ASC LIMIT 5`,
    [driver.vehicle_type]
  );
  sendJson(res, 200, {
    requests: requests.map((r) => ({
      id: r.id,
      passengerName: r.passenger_name,
      pickup: r.pickup,
      destination: r.destination,
      distanceKm: r.distance_km,
      fare: r.fare,
      createdAt: r.created_at,
    })),
  });
}, { auth: true, role: 'driver' });

route('POST', '/api/driver/rides/:id/accept', async (req, res, ctx) => {
  const driver = await getDriverByUserId(ctx.user.id);
  if (!driver) return sendJson(res, 404, { error: 'No driver profile for this account' });
  const ride = await getRide(ctx.params.id);
  if (!ride || ride.status !== 'requested') {
    return sendJson(res, 409, { error: 'This ride is no longer available' });
  }
  if (ride.vehicle_type !== driver.vehicle_type) {
    return sendJson(res, 400, { error: 'Vehicle type mismatch' });
  }
  await dbRun("UPDATE rides SET driver_id = ?, status = 'matched' WHERE id = ?", [driver.id, ride.id]);
  sendJson(res, 200, { ride: await ridePublic(await getRide(ride.id)) });
}, { auth: true, role: 'driver' });

route('GET', '/api/driver/summary', async (req, res, ctx) => {
  const driver = await getDriverByUserId(ctx.user.id);
  if (!driver) return sendJson(res, 404, { error: 'No driver profile for this account' });
  const todayRides = await dbAll(
    `SELECT * FROM rides WHERE driver_id = ? AND status = 'completed' AND {{SAMEDAY:completed_at}}
     ORDER BY completed_at DESC`,
    [driver.id]
  );
  sendJson(res, 200, {
    earningsToday: round2(driver.earnings_today),
    completedRides: driver.completed_rides,
    rating: ctx.user.rating,
    todayRides: await ridesPublic(todayRides),
  });
}, { auth: true, role: 'driver' });

// ---------------- ADMIN ----------------

route('GET', '/api/admin/stats', async (req, res) => {
  const users = (await dbGet("SELECT COUNT(*) AS n FROM users WHERE role = 'passenger'")).n;
  const drivers = (await dbGet('SELECT COUNT(*) AS n FROM drivers')).n;
  const rides = (await dbGet('SELECT COUNT(*) AS n FROM rides')).n;
  const completed = await dbGet("SELECT COUNT(*) AS n, COALESCE(SUM(fare),0) AS total FROM rides WHERE status = 'completed'");
  const revenue = round2(completed.total * PLATFORM_COMMISSION);
  sendJson(res, 200, {
    totalPassengers: Number(users),
    totalDrivers: Number(drivers),
    totalRides: Number(rides),
    completedRides: Number(completed.n),
    grossFareVolume: Number(completed.total),
    platformRevenue: revenue,
  });
}, { auth: true, role: 'admin' });

route('GET', '/api/admin/drivers', async (req, res) => {
  const drivers = await dbAll(
    `SELECT d.*, u.name, u.phone, u.rating, u.rating_count FROM drivers d
     JOIN users u ON u.id = d.user_id ORDER BY d.id DESC`
  );
  sendJson(res, 200, {
    drivers: drivers.map((d) => ({
      id: d.id, name: d.name, phone: d.phone, vehicleType: d.vehicle_type,
      plateNumber: d.plate_number, verified: !!d.verified, status: d.status,
      rating: d.rating, completedRides: d.completed_rides, earningsToday: round2(d.earnings_today),
    })),
  });
}, { auth: true, role: 'admin' });

route('POST', '/api/admin/drivers/:id/verify', async (req, res, ctx) => {
  await dbRun('UPDATE drivers SET verified = 1 WHERE id = ?', [ctx.params.id]);
  sendJson(res, 200, { ok: true });
}, { auth: true, role: 'admin' });

route('GET', '/api/admin/rides', async (req, res) => {
  const rides = await dbAll(
    `SELECT r.*, up.name AS passenger_name FROM rides r
     JOIN users up ON up.id = r.passenger_id
     ORDER BY r.created_at DESC LIMIT 50`
  );
  const publicRides = await ridesPublic(rides);
  sendJson(res, 200, {
    rides: publicRides.map((r, i) => ({ ...r, passengerName: rides[i].passenger_name })),
  });
}, { auth: true, role: 'admin' });

// ---------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------

async function handleApi(req, res, pathname, query) {
  await seedPromise; // make sure demo data exists before the very first request is handled

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.regex);
    if (!m) continue;

    const params = {};
    r.paramNames.forEach((name, i) => { params[name] = m[i + 1]; });

    let user = null;
    if (r.auth) {
      user = await getUserFromRequest(req);
      if (!user) return sendJson(res, 401, { error: 'Not logged in' });
      if (r.role && user.role !== r.role) {
        return sendJson(res, 403, { error: `This action requires the "${r.role}" role` });
      }
    }

    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
    }

    try {
      return await r.handler(req, res, { params, query, body, user });
    } catch (e) {
      console.error(e);
      return sendJson(res, 500, { error: 'Internal server error' });
    }
  }
  sendJson(res, 404, { error: 'Not found' });
}

module.exports = { handleApi };
