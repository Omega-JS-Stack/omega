/**
 * Cache the result of a cloudflare read step to .omega/cache/cloudflare/{op}.json
 * (omega-manager wrote to .output/{brandId}/cloudflare/ — in the brand-monorepo
 * world the cache lives inside the brand's own gitignored .omega/).
 *
 * Debugging aid: inspect what the service saw without re-hitting the API.
 */
const { join } = require('node:path');
const { writeJson } = require('@omega.js/devkit/write-json');

function cacheRead(brandRoot, operationName, data) {
  const filePath = join(brandRoot, '.omega', 'cache', 'cloudflare', `${operationName}.json`);
  writeJson(filePath, { read: data });
}

module.exports = { cacheRead };
