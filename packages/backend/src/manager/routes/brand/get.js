/**
 * GET /brand - Public brand configuration
 * Returns a safe subset of the project's config (no secrets)
 */
module.exports = async ({ ctx, Manager }) => {
  const config = Manager.config;

  return ctx.respond(buildPublicConfig(config));
};

/**
 * Build a public-safe config object from Manager.config
 * Excludes sensitive fields: monitoring, analytics, blog, etc.
 */
function buildPublicConfig(config) {
  const { repoBlock } = require('@omega.js/config');

  return {
    brand: config.brand || {},
    // The repo block as the config DERIVATION reads it (#883): provider + org,
    // the only two facts there are, defaulted the one way every other reader
    // defaults them. Null when the brand declares no repo at all.
    repo: repoBlock(config),
    connections: config.connections || {},
    payment: config.payment || {},
    cloud: config.cloud || {},
    reviews: config.reviews || {},
  };
}

module.exports.buildPublicConfig = buildPublicConfig;
