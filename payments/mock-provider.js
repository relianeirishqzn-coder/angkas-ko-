// src/payments/mock-provider.js
//
// DEMO-ONLY. Credits the wallet instantly with no real money changing hands
// anywhere — there's no gateway call, no settlement, nothing. This exists so
// the rest of the app (wallet UI, transaction history, ride payment flow)
// has something real to run against during development.
//
// Do not launch with this provider still active for real users. Switch
// PAYMENT_PROVIDER to a real gateway first — see PAYMENT_INTEGRATION.md.
'use strict';

async function processTopUp({ amount }) {
  return {
    status: 'completed',
    providerRef: 'MOCK-' + Date.now().toString(36).toUpperCase(),
    isDemo: true,
    message: 'Demo mode — wallet credited instantly, no real money moved.',
  };
}

module.exports = { processTopUp, isDemo: true };
