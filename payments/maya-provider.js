// src/payments/maya-provider.js
//
// NOT IMPLEMENTED — same situation as gcash-provider.js. See
// PAYMENT_INTEGRATION.md before wiring this up to Maya's real API.
'use strict';

async function processTopUp({ userId, amount, phone }) {
  throw Object.assign(
    new Error(
      'PAYMENT_PROVIDER=maya is not implemented yet. See PAYMENT_INTEGRATION.md ' +
      'for what needs to be wired up before this provider can process real top-ups.'
    ),
    { status: 501 }
  );
}

module.exports = { processTopUp, isDemo: false };
