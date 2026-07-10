/**
 * Navigate Command
 *
 * Navigates to a URL and waits for page load.
 */

import { sendCommand } from '../session.js';
import * as cursor from '../cursor.js';

const DEFAULT_TIMEOUT = 30000;

/**
 * @param {number} tabId
 * @param {{ url, waitUntil?, timeout? }} params
 */
export default async function navigate(tabId, params) {
  const { url, timeout = DEFAULT_TIMEOUT } = params;

  if (!url) {
    throw Object.assign(new Error('Missing required param: url'), { code: 'INVALID_PARAMS' });
  }

  // Set up load event listener before navigating
  const loaded = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`Navigation timeout after ${timeout}ms`), { code: 'TIMEOUT' }));
    }, timeout);

    // Listen for page load
    const checkLoaded = async () => {
      try {
        const result = await sendCommand(tabId, 'Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        });

        if (result?.result?.value === 'complete') {
          clearTimeout(timer);
          resolve();
          return;
        }
      } catch {
        // Page may be transitioning
      }

      setTimeout(checkLoaded, 200);
    };

    // Start checking after a brief delay to let navigation begin
    setTimeout(checkLoaded, 500);
  });

  // Navigate
  await sendCommand(tabId, 'Page.navigate', { url });

  // Wait for load
  await loaded;

  // Re-inject cursor overlay (navigation destroys the previous page's DOM)
  await cursor.inject(tabId);

  return { navigated: true, url };
}
