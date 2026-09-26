// The offscreen-document context: the extension base, for the long-running
// work background hands off (WebSocket connections, DOM parsing).

// Libraries
import { Omega as BaseOmega } from './omega.js';

/**
 * The offscreen document's runtime.
 */
class Omega extends BaseOmega {
  constructor() {
    super('offscreen');
  }

  /**
   * Settle `ready`.
   * @returns {Promise<Omega>} the instance.
   */
  async initialize() {
    await super.initialize();

    // Log
    this.logger.log('Initialized!', this);

    return this;
  }
}

const omega = new Omega();

export default omega;
export { Omega };
