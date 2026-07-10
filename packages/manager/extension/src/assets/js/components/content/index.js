// ============================================
// Content Script: Site-Specific Auto-Filler
// ============================================
// Detects the current site and loads the appropriate filler module.
// Shared panel UI and helpers are reused across all sites.

// Import Browser Extension Manager
import Manager from '@omegajs/extension/content';

// Site modules (statically imported — webpack doesn't support code splitting in content scripts)
import * as stripe from './sites/stripe.js';
import * as paypal from './sites/paypal.js';

// ── Site registry ────────────────────────────────────────────────────────

const SITES = [
  {
    match: (host) => host.includes('checkout.stripe.com'),
    module: stripe,
  },
  {
    match: (host) => host.includes('sandbox.paypal.com') || host.includes('paypal.com/signin'),
    module: paypal,
  },
];

// ── Initialize ───────────────────────────────────────────────────────────

const manager = new Manager();

manager.initialize()
.then(() => {
  const { logger } = manager;
  const host = window.location.hostname + window.location.pathname;

  const site = SITES.find((s) => s.match(host));
  if (!site) {
    logger.log('No filler matched for this page');
    return;
  }

  site.module.init(logger);
});
