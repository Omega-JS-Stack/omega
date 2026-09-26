// The content-script context: the extension base plus the affiliatizer, which
// runs against the HOST page this script is injected into.

// Libraries
import { Omega as BaseOmega } from './omega.js';
import Affiliatizer from './lib/affiliatizer.js';

/**
 * The content script's runtime.
 */
class Omega extends BaseOmega {
  constructor() {
    super('content');
  }

  /**
   * Settle `ready`, then run the affiliatizer over the host page.
   * @returns {Promise<Omega>} the instance.
   */
  async initialize() {
    await super.initialize();

    await Affiliatizer.initialize(this);

    // Log
    this.logger.log('Initialized!', this);

    return this;
  }
}

const omega = new Omega();

export default omega;
export { Omega };
