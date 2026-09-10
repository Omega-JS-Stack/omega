const crypto = require('crypto');

// How many ids one mint may try before it gives up. 12 random digits is a
// trillion-wide space, so a run that collides this many times in a row is not
// bad luck — it is a broken generator or a broken read, and both are worth
// hearing about ([#664](https://github.com/Omega-JS-Stack/omega/issues/664)).
const MAX_ATTEMPTS = 5;

/**
 * Generate a unique order ID in the format XXXX-XXXX-XXXX
 * 12 random digits, grouped in 3 segments of 4
 *
 * @returns {string} e.g. '4637-8821-0473'
 */
function generate() {
  const bytes = crypto.randomBytes(6);
  const digits = Array.from(bytes)
    .map(b => (b % 100).toString().padStart(2, '0'))
    .join('');

  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`;
}

/**
 * Mint an order id no intent already holds.
 *
 * The id keys `payments-intents/<orderId>` (and `payments-orders/<orderId>`
 * after it), so a repeat does not collide harmlessly — it OVERWRITES another
 * customer's intent, and hands both purchases the same analytics dedupe id. The
 * odds are small and they grow with volume, which is exactly the shape of bug
 * that is cheap now and unfixable later.
 *
 * An exhausted mint throws: an id that is already taken must never be handed
 * back, and there is nothing else this can return.
 *
 * @param {object} options
 * @param {object} options.admin - The firebase-admin app
 * @param {object} options.ctx - RouteContext, for the collision record
 * @param {function} [options.generate] - The id source, injectable so a collision can be produced on demand
 * @returns {Promise<string>} An order id no intent doc holds
 */
async function mint({ admin, ctx, generate: generateId = generate }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const orderId = generateId();
    const existing = await admin.firestore().doc(`payments-intents/${orderId}`).get();

    if (!existing.exists) {
      return orderId;
    }

    ctx.warn(`Order id collision: payments-intents/${orderId} already exists, minting another (attempt ${attempt}/${MAX_ATTEMPTS})`);
  }

  throw new Error(`Could not mint an unused order id in ${MAX_ATTEMPTS} attempts`);
}

module.exports = { generate, mint, MAX_ATTEMPTS };
