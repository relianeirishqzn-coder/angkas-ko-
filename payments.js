// src/payments.js
//
// Every wallet top-up goes through here, regardless of which provider is
// active. Switch providers with the PAYMENT_PROVIDER env var (see
// .env.example) — the API route in src/api.js never needs to change.
'use strict';

const PROVIDER_NAME = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();

const providers = {
  mock: require('./payments/mock-provider'),
  gcash: require('./payments/gcash-provider'),
  maya: require('./payments/maya-provider'),
};

function getProvider() {
  const provider = providers[PROVIDER_NAME];
  if (!provider) {
    throw new Error(
      `Unknown PAYMENT_PROVIDER "${PROVIDER_NAME}". Valid options: ${Object.keys(providers).join(', ')}`
    );
  }
  return provider;
}

async function processTopUp({ userId, amount, phone }) {
  return getProvider().processTopUp({ userId, amount, phone });
}

module.exports = {
  processTopUp,
  currentProvider: PROVIDER_NAME,
  isDemoMode: () => getProvider().isDemo,
};
