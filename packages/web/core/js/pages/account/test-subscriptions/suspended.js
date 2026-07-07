// Suspended subscription — merges into real subscription
// Backend maps Stripe 'past_due'/'unpaid' → unified 'suspended'
const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

export default {
  status: 'suspended',
  product: { id: 'max', name: 'Max' },
  expires: {
    timestamp: new Date((now + 3 * DAY) * 1000).toISOString(),
    timestampUNIX: now + 3 * DAY,
  },
  payment: {
    price: 29,
    frequency: 'monthly',
  },
  trial: {
    claimed: true,
    expires: {
      timestamp: new Date((now - 60 * DAY) * 1000).toISOString(),
      timestampUNIX: now - 60 * DAY,
    },
  },
  cancellation: {
    pending: false,
    date: { timestamp: '1970-01-01T00:00:00.000Z', timestampUNIX: 0 },
  },
};
