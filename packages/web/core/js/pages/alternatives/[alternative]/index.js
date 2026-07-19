/**
 * Alternatives Page JavaScript
 */

// Libraries
import omega from '@omega.js/client';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await omega.dom().ready();

    // Resolve after initialization
    return resolve();
  });
};
