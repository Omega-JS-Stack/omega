/**
 * Click Command
 *
 * Dispatches trusted mouse events at a selector or coordinates.
 */

import { sendCommand } from '../session.js';
import { findElement, waitForElement } from '../element.js';

const BUTTON_MAP = { left: 0, middle: 1, right: 2 };

/**
 * @param {number} tabId
 * @param {{ selector?, x?, y?, button?, count?, timeout? }} params
 */
export default async function click(tabId, params) {
  let x = params.x;
  let y = params.y;
  let elementInfo = null;

  // Resolve selector to coordinates
  if (params.selector) {
    elementInfo = params.timeout
      ? await waitForElement(tabId, params.selector, { timeout: params.timeout, visible: true })
      : await findElement(tabId, params.selector, { visible: true });

    if (!elementInfo) {
      throw Object.assign(new Error(`Element not found: ${params.selector}`), { code: 'ELEMENT_NOT_FOUND' });
    }

    x = elementInfo.x;
    y = elementInfo.y;
  }

  if (x === undefined || y === undefined) {
    throw Object.assign(new Error('No target: provide selector or x/y coordinates'), { code: 'INVALID_PARAMS' });
  }

  const button = params.button || 'left';
  const clickCount = params.count || 1;
  const buttonId = BUTTON_MAP[button] || 0;

  // Move mouse to position
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
  });

  // Press and release
  for (let i = 1; i <= clickCount; i++) {
    await sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      buttons: 1 << buttonId,
      clickCount: i,
    });

    await sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      buttons: 0,
      clickCount: i,
    });
  }

  return {
    clicked: true,
    x,
    y,
    element: elementInfo
      ? { tagName: elementInfo.tagName, text: elementInfo.text }
      : null,
  };
}
