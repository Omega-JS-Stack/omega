/**
 * Scroll Command
 *
 * Scrolls the page to an element, coordinates, or direction.
 */

import { sendCommand } from '../session.js';

/**
 * @param {number} tabId
 * @param {{ selector?, x?, y?, direction?, amount? }} params
 */
export default async function scroll(tabId, params) {
  // Scroll to element
  if (params.selector) {
    const result = await sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(params.selector)});
        if (!el) return false;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      })()`,
      returnByValue: true,
    });

    if (!result?.result?.value) {
      throw Object.assign(new Error(`Element not found: ${params.selector}`), { code: 'ELEMENT_NOT_FOUND' });
    }

    return { scrolled: true, target: params.selector };
  }

  // Scroll to coordinates
  if (params.x !== undefined || params.y !== undefined) {
    await sendCommand(tabId, 'Runtime.evaluate', {
      expression: `window.scrollTo({ left: ${params.x || 0}, top: ${params.y || 0}, behavior: 'smooth' })`,
    });

    return { scrolled: true, x: params.x || 0, y: params.y || 0 };
  }

  // Scroll by direction
  if (params.direction) {
    const amount = params.amount || 300;
    const deltas = {
      up: { deltaX: 0, deltaY: -amount },
      down: { deltaX: 0, deltaY: amount },
      left: { deltaX: -amount, deltaY: 0 },
      right: { deltaX: amount, deltaY: 0 },
    };

    const delta = deltas[params.direction];

    if (!delta) {
      throw Object.assign(new Error(`Invalid direction: ${params.direction}`), { code: 'INVALID_PARAMS' });
    }

    await sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 0,
      y: 0,
      ...delta,
    });

    return { scrolled: true, direction: params.direction, amount };
  }

  throw Object.assign(new Error('Provide selector, coordinates, or direction'), { code: 'INVALID_PARAMS' });
}
