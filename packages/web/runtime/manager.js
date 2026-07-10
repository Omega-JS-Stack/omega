/**
 * The frontend Manager handed to every global/page module as
 * `{ manager, options }` — UJM's src/index.js Manager minus the webpack
 * module loading (build-time layering picks the winning page module now).
 * Wraps the @omegajs/client singleton and carries the browser-side mode helpers.
 *
 * Environment comes from `window.Configuration.environment`, baked into the
 * page by core/foot.html at build time (`jekyll.environment` global — set by
 * the engine from the build's `environment` option).
 */
import webManager from '@omegajs/client';

class Manager {
  constructor() {
    this.webManager = webManager;
  }

  getEnvironment() {
    const config = (typeof window !== 'undefined' && window.Configuration) || {};
    return config.environment || 'development';
  }

  isDevelopment() {
    return this.getEnvironment() === 'development';
  }

  isProduction() {
    return this.getEnvironment() === 'production';
  }

  isTesting() {
    return this.getEnvironment() === 'testing';
  }
}

export { Manager };
