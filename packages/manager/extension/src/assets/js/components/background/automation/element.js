/**
 * Element Finding Utility
 *
 * Resolves CSS selectors to coordinates and element info
 * using Runtime.evaluate (works with shadow DOM).
 */

import { sendCommand } from './session.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

/**
 * Find an element by CSS selector and return its center coordinates + metadata
 *
 * @returns {{ found, x, y, rect, tagName, text }} or null if not found
 */
export async function findElement(tabId, selector, options = {}) {
  const result = await sendCommand(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;

      ${options.visible ? `
      const style = getComputedStyle(el);
      if (el.offsetParent === null && style.position !== 'fixed' && style.position !== 'sticky') return null;
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return null;
      ` : ''}

      const rect = el.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        tagName: el.tagName,
        text: (el.textContent || '').trim().slice(0, 200),
        value: el.value || null,
      };
    })()`,
    returnByValue: true,
    awaitPromise: false,
  });

  if (!result?.result?.value) {
    return null;
  }

  return { found: true, ...result.result.value };
}

/**
 * Wait for an element matching a selector to appear (with optional visibility check)
 *
 * @returns element info or throws on timeout
 */
export async function waitForElement(tabId, selector, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const el = await findElement(tabId, selector, { visible: options.visible });

    if (el) {
      return el;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error(`Timeout waiting for element: ${selector}`);
}

/**
 * Wait for a JS condition to be truthy
 *
 * @returns evaluation result or throws on timeout
 */
export async function waitForCondition(tabId, expression, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await sendCommand(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result?.result?.value) {
      return result.result.value;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error(`Timeout waiting for condition: ${expression}`);
}
