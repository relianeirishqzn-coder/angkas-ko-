// public/app.js
'use strict';

/* ============ API HELPER ============ */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ============ APP STATE ============ */
const state = {
  user: null,
  vehicle: 'motor',
  destination: '',
  fareQuote: null,
  currentRideId: null,
  rideProgressInterval: null,
  isDriverMode: false,
  driverOnline: false,
  ratingStars: 5,
  ratingTip: 0,
  signupRole: 'passenger',
  signupVehicle: 'motor',
  paymentIsDemo: true,
};

/* ============ NAVIGATION ============ */
function go(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const target = document.getElementById('screen-' + screenId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.s === screenId));
  const showNav = ['home', 'activity', 'wallet', 'profile'].includes(screenId);
  document.getElementById('bottomnav').style.display = showNav ? 'flex' : 'none';

  if (screenId === 'activity') loadHistory();
  if (screenId === 'wallet') loadWallet();
  if (screenId === 'driver') loadDriverScreen();
  if (screenId === 'admin') loadAdminScreen();
}
document.getElementById('bottomnav').style.display = 'none';

/* ============ TOAST ============ */
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ============ MODALS ============ */
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

async function sendSOS() {
  closeModal('sosModal');
  if (!state.currentRideId) return;
  try {
    const data = await api(`/api/rides/${state.currentRideId}/sos`, { method: 'POST' });
    toast('🆘 ' + data.message);
  } catch (e) {
    toast('Could not send SOS: ' + e.message);
  }
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.classList.add('show');
}
function hideError(elId) {
  document.getElementById(elId).classList.remove('show');
}

/* ============ AUTH ============ */
function fillDemo(phone, pass) {
  document.getElementById('loginPhone').value = phone;
  document.getElementById('loginPass').value = pass;
}

function showSignup() {
  document.getElementById('loginFields').style.display = 'none';
  document.getElementById('signupFields').style.display = 'flex';
  document.getElementById('signupFields').style.flexDirection = 'column';
  document.getElementById('signupFields').style.gap = '12px';
  document.getElementById('authGreet').textContent = 'Sumali sa Angkas Ko!';
  document.getElementById('authSub').textContent = 'Create an account to start booking rides.';
}
function showLogin() {
  document.getElementById('loginFields').style.display = 'flex';
  document.getElementById('signupFields').style.display = 'none';
  document.getElementById('authGreet').textContent = 'Maligayang pagdating!';
  document.getElementById('authSub').textContent = 'Log in to book your ride around town.';
}

function selectRole(role) {
  state.signupRole = role;
  document.querySelectorAll('.role-chip').forEach((c) => c.classList.toggle('sel', c.dataset.role === role));
  document.getElementById('driverFields').style.display = role === 'driver' ? 'flex' : 'none';
}
function selectSignupVehicle(v) {
  state.signupVehicle = v;
  document.querySelectorAll('#driverFields .vehicle-card').forEach((c) => c.classList.toggle('sel', c.dataset.v === v));
}

async function doLogin() {
  hideError('loginError');
  const phone = document.getElementById('loginPhone').value.trim();
  const password = document.getElementById('loginPass').value;
  if (!phone || !password) return showError('loginError', 'Enter your mobile number and password');
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Logging in…';
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { phone, password } });
    state.user = data.user;
    toast('Welcome back, ' + data.user.name.split(' ')[0] + '! 👋');
    enterApp();
  } catch (e) {
    showError('loginError', e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Log In';
  }
}

async function doSignup() {
  hideError('signupError');
  const name = document.getElementById('suName').value.trim();
  const phone = document.getElementById('suPhone').value.trim();
  const password = document.getElementById('suPass').value;
  if (!name || !phone || !password) return showError('signupError', 'Please fill in all fields');

  const body = { name, phone, password, role: state.signupRole };
  if (state.signupRole === 'driver') {
    const plateNumber = document.getElementById('suPlate').value.trim();
    const vehicleDesc = document.getElementById('suVehicleDesc').value.trim();
    if (!plateNumber) return showError('signupError', 'Enter your plate number');
    body.vehicleType = state.signupVehicle;
    body.plateNumber = plateNumber;
    body.vehicleDesc = vehicleDesc || (state.signupVehicle === 'motor' ? 'Motorcycle' : state.signupVehicle === 'tricycle' ? 'Tricycle' : 'Car');
  }

  const btn = document.getElementById('signupBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Creating account…';
  try {
    const data = await api('/api/auth/register', { method: 'POST', body });
    state.user = data.user;
    toast('Maligayang pagdating, ' + data.user.name.split(' ')[0] + '! Account created.');
    if (state.signupRole === 'driver') {
      toast('Your driver account is pending barangay verification.');
    }
    enterApp();
  } catch (e) {
    showError('signupError', e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.user = null;
  state.currentRideId = null;
  clearInterval(state.rideProgressInterval);
  go('login');
  showLogin();
}

function applyUserToUI() {
  const u = state.user;
  const initials = u.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('homeGreet').textContent = 'Where to, ' + u.name.split(' ')[0] + '?';
  document.getElementById('homeAvatar').textContent = initials;
  document.getElementById('profileAvatar').textContent = initials;
  document.getElementById('profileName').textContent = u.name;
  document.getElementById('profileRatingLine').textContent = `★★★★★ ${u.rating.toFixed(1)} Rating (${u.ratingCount} rides)`;
  document.getElementById('sw-student').classList.toggle('on', u.studentDiscount);
  document.getElementById('sw-senior').classList.toggle('on', u.seniorMode);
  document.getElementById('sw-emergency').classList.toggle('on', u.emergencyAlerts);
  document.getElementById('promoStudent').style.outline = u.studentDiscount ? '2px solid var(--orange)' : 'none';
  document.getElementById('promoSenior').style.outline = u.seniorMode ? '2px solid var(--orange)' : 'none';
  document.getElementById('driverModeBtn').textContent = u.role === 'driver' ? 'Switch to Driver Mode' : 'Register as a Driver';
}

async function enterApp() {
  applyUserToUI();
  if (state.user.role === 'admin') {
    go('admin');
  } else {
    go('home');
  }
}

/* Try to resume a session on page load (real cookie-based auth) */
async function tryResumeSession() {
  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
    applyUserToUI();
    go(state.user.role === 'admin' ? 'admin' : 'home');
    return true;
  } catch {
    return false;
  }
}

/* ============ BOOKING ============ */
function selectVehicle(v) {
  state.vehicle = v;
  document.querySelectorAll('#screen-home .vehicle-card').forEach((c) => c.classList.toggle('sel', c.dataset.v === v));
  calcFare();
}

let fareDebounce;
function calcFare() {
  const dest = document.getElementById('destField').value.trim();
  state.destination = dest;
  clearTimeout(fareDebounce);
  if (!dest) {
    document.getElementById('fareVal').textContent = '₱—';
    state.fareQuote = null;
    return;
  }
  fareDebounce = setTimeout(async () => {
    try {
      const quote = await api('/api/fare/quote', { method: 'POST', body: { vehicleType: state.vehicle, destination: dest } });
      state.fareQuote = quote;
      document.getElementById('fareVal').textContent = '₱' + quote.fare.toFixed(2);
      document.getElementById('etaMin').textContent = quote.etaMin;
    } catch (e) {
      toast(e.message);
    }
  }, 300);
}

async function bookRide() {
  hideError('bookError');
  if (!state.destination) return showError('bookError', 'Please enter your destination first');
  const pickup = document.getElementById('pickupField').value.trim() || 'Current Location';
  const btn = document.getElementById('bookBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Booking…';
  try {
    const data = await api('/api/rides', {
      method: 'POST',
      body: { vehicleType: state.vehicle, pickup, destination: state.destination },
    });
    state.currentRideId = data.ride.id;
    go('finding');
    if (data.ride.status === 'matched') {
      document.getElementById('findingTitle').textContent = 'Driver found!';
      document.getElementById('findingSub').textContent = data.ride.driver.name + ' is heading your way';
      setTimeout(() => enterTracking(data.ride), 1600);
    } else {
      document.getElementById('findingTitle').textContent = 'Finding you a nearby rider…';
      document.getElementById('findingSub').textContent = 'All drivers are busy — you\u2019ll be matched as soon as one is free';
      pollForMatch(data.ride.id);
    }
  } catch (e) {
    showError('bookError', e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Book Ride';
  }
}

let matchPollInterval;
function pollForMatch(rideId) {
  clearInterval(matchPollInterval);
  matchPollInterval = setInterval(async () => {
    try {
      const data = await api(`/api/rides/${rideId}`);
      if (data.ride.status === 'matched') {
        clearInterval(matchPollInterval);
        enterTracking(data.ride);
      } else if (data.ride.status === 'cancelled') {
        clearInterval(matchPollInterval);
        go('home');
      }
    } catch { /* keep polling */ }
  }, 2500);
}

function cancelFinding() {
  clearInterval(matchPollInterval);
  if (state.currentRideId) {
    api(`/api/rides/${state.currentRideId}/cancel`, { method: 'POST' }).catch(() => {});
  }
  state.currentRideId = null;
  go('home');
  toast('Ride request cancelled');
}

/* ============ TRACKING (client-side animation over a real matched ride) ============ */
function enterTracking(ride) {
  state.currentRideId = ride.id;
  go('tracking');
  document.getElementById('trackDriverName').textContent = ride.driver.name + ' \u2b50' + ride.driver.rating.toFixed(1);
  document.getElementById('driverVehicleInfo').textContent = `${ride.driver.vehicleDesc} • ${ride.driver.plateNumber}`;
  document.getElementById('trackVerifiedBadge').style.display = ride.driver.verified ? 'inline-flex' : 'none';
  document.getElementById('endRideBtn').style.display = 'none';
  document.getElementById('stagePickup').className = 'stage-item now';
  document.getElementById('stageOngoing').className = 'stage-item';
  document.getElementById('stageDone').className = 'stage-item';
  document.getElementById('rideProgress').style.width = '0%';
  document.getElementById('trackEta').textContent = 3;

  api(`/api/rides/${ride.id}/start`, { method: 'POST' }).catch(() => {});

  let progress = 0;
  const driverPin = document.getElementById('driverPin');
  clearInterval(state.rideProgressInterval);
  state.rideProgressInterval = setInterval(() => {
    progress += 12;
    document.getElementById('rideProgress').style.width = Math.min(progress, 100) + '%';
    document.getElementById('trackEta').textContent = Math.max(0, Math.ceil((100 - progress) / 33));
    driverPin.style.top = (120 - progress * 0.8) + 'px';
    driverPin.style.left = (150 - progress * 0.6) + 'px';

    if (progress >= 34 && progress < 46) {
      document.getElementById('stagePickup').className = 'stage-item done';
      document.getElementById('stageOngoing').className = 'stage-item now';
      toast('🏍️ ' + ride.driver.name.split(' ')[0] + ' picked you up — ride started');
    }
    if (progress >= 100) {
      clearInterval(state.rideProgressInterval);
      document.getElementById('stageOngoing').className = 'stage-item done';
      document.getElementById('stageDone').className = 'stage-item now';
      document.getElementById('endRideBtn').style.display = 'block';
      toast('📍 Arrived at destination');
    }
  }, 900);
}

async function endRide() {
  clearInterval(state.rideProgressInterval);
  document.getElementById('stageDone').className = 'stage-item done';
  try {
    const data = await api(`/api/rides/${state.currentRideId}/complete`, { method: 'POST' });
    state.user.walletBalance = data.walletBalance;
    state.ratingStars = 5;
    state.ratingTip = 0;
    document.querySelectorAll('.star').forEach((s) => s.classList.toggle('on', parseInt(s.dataset.n) <= 5));
    document.querySelectorAll('.tip-chip').forEach((c, i) => c.classList.toggle('sel', i === 0));
    document.getElementById('ratingTitle').textContent = 'Rate your ride with ' + data.ride.driver.name;
    go('rating');
  } catch (e) {
    toast('Could not complete ride: ' + e.message);
  }
}

/* ============ RATING ============ */
document.querySelectorAll('.star').forEach((star) => {
  star.addEventListener('click', () => {
    const n = parseInt(star.dataset.n);
    state.ratingStars = n;
    document.querySelectorAll('.star').forEach((s) => s.classList.toggle('on', parseInt(s.dataset.n) <= n));
  });
});
function selectTip(el, amt) {
  document.querySelectorAll('.tip-chip').forEach((c) => c.classList.remove('sel'));
  el.classList.add('sel');
  state.ratingTip = amt;
}
async function submitRating() {
  const btn = document.getElementById('submitRatingBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Submitting…';
  try {
    await api(`/api/rides/${state.currentRideId}/rate`, {
      method: 'POST',
      body: { stars: state.ratingStars, tip: state.ratingTip },
    });
    toast(`Thanks for rating your ride! ⭐ ${state.ratingStars}/5`);
    document.getElementById('destField').value = '';
    document.getElementById('fareVal').textContent = '₱—';
    state.currentRideId = null;
    const me = await api('/api/auth/me');
    state.user = me.user;
    applyUserToUI();
    go('home');
  } catch (e) {
    toast('Could not submit rating: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Rating';
  }
}

/* ============ HISTORY ============ */
async function loadHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const data = await api('/api/rides');
    if (data.rides.length === 0) {
      list.innerHTML = '<div class="empty-state">No rides yet. Book your first Angkas Ko ride! 🏍️</div>';
      return;
    }
    const vIcon = { motor: '🏍️', tricycle: '🛺', car: '🚗' };
    list.innerHTML = data.rides.map((r) => `
      <div class="ride-item">
        <div class="ride-ic">${vIcon[r.vehicleType] || '🚗'}</div>
        <div>
          <div class="ride-route">${escapeHtml(r.pickup)} → ${escapeHtml(r.destination)}</div>
          <div class="ride-meta">${formatDate(r.createdAt)} • ${r.status}${r.driver ? ' • ' + escapeHtml(r.driver.name) : ''}</div>
        </div>
        <div class="ride-fare">₱${r.fare.toFixed(0)}</div>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = `<div class="empty-state">Could not load history: ${escapeHtml(e.message)}</div>`;
  }
}

/* ============ WALLET ============ */
async function loadWallet() {
  document.getElementById('walletAmt').textContent = state.user.walletBalance.toFixed(2);
  document.getElementById('paymentDemoNote').style.display = state.paymentIsDemo ? 'block' : 'none';
  const txList = document.getElementById('walletTxList');
  txList.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const data = await api('/api/wallet');
    document.getElementById('walletAmt').textContent = data.balance.toFixed(2);
    if (data.transactions.length === 0) {
      txList.innerHTML = '<div class="empty-state">No transactions yet.</div>';
      return;
    }
    const labels = { topup: 'Wallet Cash-in', fare: 'Ride Fare', tip: 'Tip', ride_earning: 'Ride Earning', tip_earning: 'Tip Received' };
    txList.innerHTML = data.transactions.map((t) => `
      <div class="wallet-tx-item">
        <div><div>${labels[t.type] || t.type}</div><div class="wtx-note">${escapeHtml(t.note || '')} • ${formatDate(t.created_at)}</div></div>
        <div class="wallet-tx-amt ${t.amount < 0 ? 'neg' : 'pos'}">${t.amount < 0 ? '-' : '+'}₱${Math.abs(t.amount).toFixed(2)}</div>
      </div>`).join('');
  } catch (e) {
    txList.innerHTML = `<div class="empty-state">Could not load wallet: ${escapeHtml(e.message)}</div>`;
  }
}
async function topUp(amt) {
  try {
    const data = await api('/api/wallet/topup', { method: 'POST', body: { amount: amt } });
    state.user.walletBalance = data.balance;
    document.getElementById('walletAmt').textContent = data.balance.toFixed(2);
    document.getElementById('paymentDemoNote').style.display = data.isDemo ? 'block' : 'none';
    toast(data.isDemo ? `₱${amt.toFixed(2)} added — ${data.message}` : `₱${amt.toFixed(2)} added to your wallet`);
    loadWallet();
  } catch (e) {
    toast('Top-up failed: ' + e.message);
  }
}

/* ============ PROFILE TOGGLES ============ */
async function toggleSwitch(el) {
  el.classList.toggle('on');
  const settings = {
    studentDiscount: document.getElementById('sw-student').classList.contains('on'),
    seniorMode: document.getElementById('sw-senior').classList.contains('on'),
    emergencyAlerts: document.getElementById('sw-emergency').classList.contains('on'),
  };
  try {
    const data = await api('/api/user/settings', { method: 'POST', body: settings });
    state.user = data.user;
    if (el.id === 'sw-student' && settings.studentDiscount) toast('Student Discount enabled — 10% off fares');
    if (el.id === 'sw-senior' && settings.seniorMode) toast('Senior Citizen Mode enabled — 20% off fares');
    if (el.id === 'sw-emergency') toast(settings.emergencyAlerts ? 'Emergency Contact Alerts enabled' : 'Emergency Contact Alerts disabled');
  } catch (e) {
    el.classList.toggle('on'); // revert on failure
    toast('Could not save setting: ' + e.message);
  }
}

/* ============ DRIVER MODE ============ */
async function toggleDriverMode() {
  if (state.isDriverMode) {
    state.isDriverMode = false;
    return go('profile');
  }
  if (state.user.role !== 'driver') {
    toast('This account isn\u2019t registered as a driver yet. Log out and sign up with the Driver role to try it.');
    return;
  }
  state.isDriverMode = true;
  go('driver');
}

async function loadDriverScreen() {
  document.getElementById('driverGreet').textContent = 'Kumusta, ' + state.user.name.split(' ')[0] + '!';
  try {
    const { driver } = await api('/api/driver/me');
    document.getElementById('driverVehicleLine').textContent = `${driver.vehicleDesc} • ${driver.plateNumber}`;
    state.driverOnline = driver.status === 'online';
    updateOnlineUI();
    await refreshDriverSummary();
    await refreshDriverRequests();
  } catch (e) {
    toast(e.message);
    go('profile');
  }
}

function updateOnlineUI() {
  document.getElementById('sw-online').classList.toggle('on', state.driverOnline);
  document.getElementById('onlineDot').classList.toggle('on', state.driverOnline);
  document.getElementById('onlineLabel').textContent = state.driverOnline ? "You're Online" : "You're Offline";
  document.getElementById('requestArea').style.display = state.driverOnline ? 'block' : 'none';
}

async function toggleOnline(el) {
  state.driverOnline = !state.driverOnline;
  try {
    await api('/api/driver/status', { method: 'POST', body: { online: state.driverOnline } });
    updateOnlineUI();
    toast(state.driverOnline ? 'You are now online and visible to nearby passengers' : 'You are now offline');
    if (state.driverOnline) refreshDriverRequests();
  } catch (e) {
    state.driverOnline = !state.driverOnline;
    toast('Could not update status: ' + e.message);
  }
}

let driverRequestPoll;
async function refreshDriverRequests() {
  clearInterval(driverRequestPoll);
  if (!state.driverOnline) {
    document.getElementById('requestArea').innerHTML = '';
    return;
  }
  const render = async () => {
    try {
      const data = await api('/api/driver/requests');
      const area = document.getElementById('requestArea');
      if (data.requests.length === 0) {
        area.innerHTML = '<div class="empty-state" style="padding:20px 22px;">No pending ride requests right now.</div>';
        return;
      }
      const r = data.requests[0];
      area.innerHTML = `
        <div class="request-card" id="requestCard">
          <div class="rtitle">🔔 NEW RIDE REQUEST</div>
          <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700;">
            <span>${escapeHtml(r.passengerName)}</span><span>₱${r.fare.toFixed(2)}</span>
          </div>
          <div style="font-size:11.5px; color:var(--sub); margin-top:6px;">📍 ${escapeHtml(r.pickup)} → 🎯 ${escapeHtml(r.destination)} • ${r.distanceKm.toFixed(1)} km</div>
          <div class="request-row">
            <button class="btn btn-ghost" onclick="declineRequest(${r.id})">Decline</button>
            <button class="btn btn-primary" onclick="acceptRequest(${r.id})">Accept</button>
          </div>
        </div>`;
    } catch { /* ignore transient errors while polling */ }
  };
  await render();
  driverRequestPoll = setInterval(render, 4000);
}
function declineRequest() {
  toast('Request skipped — searching for the next rider');
}
async function acceptRequest(rideId) {
  try {
    await api(`/api/driver/rides/${rideId}/accept`, { method: 'POST' });
    toast('Ride accepted — head to the pickup point');
    clearInterval(driverRequestPoll);
    document.getElementById('requestArea').innerHTML = '<div class="empty-state" style="padding:20px 22px;">Ride in progress. Complete it from the passenger\u2019s app in this demo.</div>';
    refreshDriverSummary();
  } catch (e) {
    toast('Could not accept: ' + e.message);
    refreshDriverRequests();
  }
}

async function refreshDriverSummary() {
  try {
    const data = await api('/api/driver/summary');
    document.getElementById('earningsToday').textContent = '₱' + data.earningsToday.toFixed(2);
    document.getElementById('earningsRides').textContent = data.completedRides;
    document.getElementById('earningsRating').textContent = data.rating.toFixed(1) + ' ★';
    const list = document.getElementById('driverRideList');
    if (data.todayRides.length === 0) {
      list.innerHTML = '<div class="empty-state">No completed rides yet today.</div>';
    } else {
      const vIcon = { motor: '🏍️', tricycle: '🛺', car: '🚗' };
      list.innerHTML = data.todayRides.map((r) => `
        <div class="ride-item">
          <div class="ride-ic">${vIcon[r.vehicleType] || '🚗'}</div>
          <div><div class="ride-route">${escapeHtml(r.pickup)} → ${escapeHtml(r.destination)}</div><div class="ride-meta">${formatDate(r.completedAt)}</div></div>
          <div class="ride-fare">₱${r.fare.toFixed(0)}</div>
        </div>`).join('');
    }
  } catch (e) {
    toast(e.message);
  }
}

/* ============ ADMIN ============ */
async function loadAdminScreen() {
  try {
    const stats = await api('/api/admin/stats');
    document.getElementById('adminPassengers').textContent = stats.totalPassengers;
    document.getElementById('adminDrivers').textContent = stats.totalDrivers;
    document.getElementById('adminRides').textContent = stats.totalRides;
    document.getElementById('adminRevenue').textContent = stats.platformRevenue.toFixed(2);
  } catch (e) { toast(e.message); }

  try {
    const { drivers } = await api('/api/admin/drivers');
    document.getElementById('adminDriverList').innerHTML = drivers.map((d) => `
      <div class="ride-item">
        <div class="ride-ic">${d.vehicleType === 'motor' ? '🏍️' : d.vehicleType === 'tricycle' ? '🛺' : '🚗'}</div>
        <div>
          <div class="ride-route">${escapeHtml(d.name)} ${d.verified ? '✔' : ''}</div>
          <div class="ride-meta">${escapeHtml(d.plateNumber)} • ${d.status} • ★${d.rating.toFixed(1)}</div>
        </div>
        ${d.verified ? '' : `<button class="btn btn-primary" style="padding:8px 12px; font-size:11px;" onclick="verifyDriver(${d.id})">Verify</button>`}
      </div>`).join('') || '<div class="empty-state">No drivers yet.</div>';
  } catch (e) { toast(e.message); }

  try {
    const { rides } = await api('/api/admin/rides');
    document.getElementById('adminRideList').innerHTML = rides.slice(0, 15).map((r) => `
      <div class="ride-item">
        <div class="ride-ic">${r.vehicleType === 'motor' ? '🏍️' : r.vehicleType === 'tricycle' ? '🛺' : '🚗'}</div>
        <div><div class="ride-route">${escapeHtml(r.passengerName)} — ${escapeHtml(r.destination)}</div><div class="ride-meta">${formatDate(r.createdAt)} • ${r.status}</div></div>
        <div class="ride-fare">₱${r.fare.toFixed(0)}</div>
      </div>`).join('') || '<div class="empty-state">No rides yet.</div>';
  } catch (e) { toast(e.message); }
}
async function verifyDriver(id) {
  try {
    await api(`/api/admin/drivers/${id}/verify`, { method: 'POST' });
    toast('Driver verified ✔');
    loadAdminScreen();
  } catch (e) {
    toast(e.message);
  }
}

/* ============ UTILS ============ */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ============ CLOCK ============ */
function updateClock() {
  const d = new Date();
  let h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  document.getElementById('clock').textContent = h + ':' + String(m).padStart(2, '0');
}
updateClock();
setInterval(updateClock, 30000);

/* ============ SPLASH DOTS ============ */
let dotIdx = 0;
setInterval(() => {
  if (!document.getElementById('screen-splash').classList.contains('active')) return;
  dotIdx = (dotIdx + 1) % 3;
  document.querySelectorAll('.splash-dots span').forEach((s, i) => s.classList.toggle('on', i === dotIdx));
}, 1200);

/* ============ BOOT ============ */
(async function boot() {
  try {
    const cfg = await api('/api/config');
    state.paymentIsDemo = cfg.paymentIsDemo;
  } catch { /* default stays true */ }
  const resumed = await tryResumeSession();
  if (!resumed) {
    // stay on splash screen until the user taps "Get Started"
  }
})();
