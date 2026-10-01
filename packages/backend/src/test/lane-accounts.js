/**
 * The sign-in lanes' own personas: machinery (no `palette` label), one per root
 * lane that signs in. Each lane asks `GET /test/roster?machinery=true` for its
 * persona and signs in with the shared test password, so no suite mints an
 * account of its own. test-accounts.js seeds them as STATIC accounts, because a
 * sign-in needs an established user the consent guard lets through.
 */

// One lane's persona: a basic subscriber whose only story is signing in
function lanePersona(id) {
  return {
    id,
    uid: `_test-${id}`,
    email: `_test.${id}@{domain}`,
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  };
}

const LANE_ACCOUNTS = {
  'desktop-auth-e2e': lanePersona('desktop-auth-e2e'),
  'extension-auth-e2e': lanePersona('extension-auth-e2e'),
  'auth-token-e2e': lanePersona('auth-token-e2e'),
  'flows-signin': lanePersona('flows-signin'),
};

module.exports = { LANE_ACCOUNTS };
