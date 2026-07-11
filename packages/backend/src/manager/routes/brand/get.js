/**
 * GET /brand - Public brand configuration
 * Returns a safe subset of the project's config (no secrets)
 */
module.exports = async ({ assistant, Manager }) => {
  const config = Manager.config;

  return assistant.respond(buildPublicConfig(config));
};

/**
 * Build a public-safe config object from Manager.config
 * Excludes sensitive fields: monitoring, analytics, blog, etc.
 */
function buildPublicConfig(config) {
  return {
    brand: config.brand || {},
    github: config.github || {},
    oauth2: config.oauth2 || {},
    payment: config.payment || {},
    cloud: config.cloud || {},
    reviews: config.reviews || {},
  };
}

module.exports.buildPublicConfig = buildPublicConfig;
