/**
 * Cache the result of a cloudflare read step to .omega/cache/cloudflare/{op}.json
 * (omega-manager wrote to .output/{brandId}/cloudflare/ — in the brand-monorepo
 * world the cache lives inside the brand's own gitignored .omega/).
 *
 * Debugging aid: inspect what the service saw without re-hitting the API.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

function cacheRead(brandRoot, operationName, data) {
  const filePath = join(brandRoot, '.omega', 'cache', 'cloudflare', `${operationName}.json`);
  jetpack.write(filePath, { read: data });
}

module.exports = { cacheRead };
