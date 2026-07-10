/**
 * Alternatives Page JavaScript
 */

// Libraries
import webManager from '@omegajs/client';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    // Resolve after initialization
    return resolve();
  });
};
