// Active subscription — merges into real subscription
const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

export default {
  status: 'active',
  product: { id: 'max', name: 'Max' },
  expires: {
    timestamp: new Date((now + 30 * DAY) * 1000).toISOString(),
    timestampUNIX: now + 30 * DAY,
  },
  payment: {
    price: 29,
    frequency: 'monthly',
  },
  trial: {
    claimed: true,
    expires: {
      timestamp: new Date((now - 31 * DAY) * 1000).toISOString(),
      timestampUNIX: now - 31 * DAY,
    },
  },
  cancellation: {
    pending: false,
    date: { timestamp: '1970-01-01T00:00:00.000Z', timestampUNIX: 0 },
  },
};
