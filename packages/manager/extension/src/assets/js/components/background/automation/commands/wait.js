/**
 * Wait Command
 *
 * Waits for an element to appear/disappear or a condition to be true.
 */

import { waitForElement, waitForCondition } from '../element.js';
import { sendCommand } from '../session.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

/**
 * @param {number} tabId
 * @param {{ selector?, condition?, timeout?, visible?, hidden? }} params
 */
export default async function wait(tabId, params) {
  const timeout = params.timeout || DEFAULT_TIMEOUT;

  // Wait for element to disappear
  if (params.selector && params.hidden) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await sendCommand(tabId, 'Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(params.selector)}) === null`,
        returnByValue: true,
      });

      if (result?.result?.value === true) {
        return { found: false, hidden: true };
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    throw Object.assign(
      new Error(`Timeout waiting for element to disappear: ${params.selector}`),
      { code: 'TIMEOUT' },
    );
  }

  // Wait for element to appear
  if (params.selector) {
    const el = await waitForElement(tabId, params.selector, {
      timeout,
      visible: params.visible,
    });

    return {
      found: true,
      element: { tagName: el.tagName, text: el.text },
    };
  }

  // Wait for JS condition
  if (params.condition) {
    const value = await waitForCondition(tabId, params.condition, { timeout });

    return { found: true, value };
  }

  // Simple delay
  if (params.delay) {
    await new Promise((r) => setTimeout(r, params.delay));
    return { waited: true, delay: params.delay };
  }

  throw Object.assign(new Error('Provide selector, condition, or delay'), { code: 'INVALID_PARAMS' });
}
