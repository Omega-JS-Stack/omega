// Libraries
import extension from './lib/extension.js';
import LoggerLite from './lib/logger-lite.js';
import Messaging from './lib/messaging.js';
import Affiliatizer from './lib/affiliatizer.js';
import { attachTo as attachModeHelpers } from './utils/mode-helpers.js';

// Class
class Manager {
  constructor() {
    // Properties
    this.extension = null;
    this.messenger = null;
    this.logger = null;
    this.affiliatizer = null;
  }

  async initialize() {
    // Set properties
    this.extension = extension;
    this.messenger = new Messaging({ sender: 'content' });
    this.logger = new LoggerLite('content');
    this.affiliatizer = Affiliatizer.initialize(this);

    // Log
    this.logger.log('Initialized!', this);

    // Return manager instance
    return this;
  }
}

// Cross-context helpers — Manager.isTesting() / isDevelopment() / etc.
attachModeHelpers(Manager);

// Export
export default Manager;
