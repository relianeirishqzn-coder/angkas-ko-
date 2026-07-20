// src/payments/gcash-provider.js
//
// NOT IMPLEMENTED. This is a scaffold marking exactly where a real GCash
// integration plugs in, so switching PAYMENT_PROVIDER=gcash fails loudly and
// clearly instead of silently pretending to charge someone.
//
// See PAYMENT_INTEGRATION.md at the project root for the full checklist
// (merchant account, API credentials, webhook/callback URL, signature
// verification, idempotency, reconciliation) before implementing this.
'use strict';

async function processTopUp({ userId, amount, phone }) {
  throw Object.assign(
    new Error(
      'PAYMENT_PROVIDER=gcash is not implemented yet. See PAYMENT_INTEGRATION.md ' +
      'for what needs to be wired up before this provider can process real top-ups.'
    ),
    { status: 501 }
  );
}

module.exports = { processTopUp, isDemo: false };
