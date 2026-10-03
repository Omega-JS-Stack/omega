/**
 * The Cloudflare account id for an edge operation: the account that owns the
 * zone, or the token's first account when no zone is in play (the `zone`
 * operation, which resolves the account before it resolves the zone).
 */
const { getZoneId } = require('./ruleset-helper.js');

/**
 * Resolve the account id the account-level endpoints (workers, email routing
 * addresses, Web Analytics sites, zone creation) are called under.
 *
 * @param {Object} context - Edge operation context (cloudflareApi, zoneId, serviceData)
 * @param {string|null} [zoneId] - The zone whose account to read; null reads the token's first account
 * @returns {Promise<string>} The account id
 * @throws {Error} When the token reaches no account at all
 */
async function accountId(context, zoneId = getZoneId(context)) {
  const api = context.cloudflareApi;

  if (zoneId) {
    const zone = await api.makeRequest(`/zones/${zoneId}`);
    return zone.result.account.id;
  }

  const accounts = await api.makeRequest('/accounts');
  if (!accounts.result || accounts.result.length === 0) {
    throw new Error('No Cloudflare account found for this token');
  }
  return accounts.result[0].id;
}

module.exports = { accountId };
