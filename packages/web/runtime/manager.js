/**
 * The frontend Manager handed to every global/page module as
 * `{ manager, options }` — UJM's src/index.js Manager minus the webpack
 * module loading (build-time layering picks the winning page module now).
 * Wraps the @omega.js/client singleton and carries the browser-side mode helpers.
 *
 * Environment comes from `window.OMEGA_BUILD_JSON.config.environment`, baked
 * into the page by the build (#894), and it is read by the ONE environment
 * module ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)) through
 * the @omega.js/client singleton this class already wraps. This used to be a
 * fifth copy of the same four functions, with a `|| 'development'` default of
 * its own: a page whose build forgot to bake the fact read as development and
 * connected to a local emulator that was not there. It has no default now, and
 * a missing fact throws by name.
 */
import omega from '@omega.js/client';

class Manager {
  constructor() {
    this.omega = omega;
  }

  getEnvironment() {
    return omega.getEnvironment();
  }

  isDevelopment() {
    return omega.isDevelopment();
  }

  isProduction() {
    return omega.isProduction();
  }

  isTesting() {
    return omega.isTesting();
  }
}

export { Manager };
