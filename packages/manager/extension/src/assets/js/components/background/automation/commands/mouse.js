/**
 * Mouse Move Command
 *
 * Dispatches trusted mouse movement events with optional interpolation.
 */

import { sendCommand } from '../session.js';

/**
 * @param {number} tabId
 * @param {{ x, y, steps? }} params
 */
export default async function mouse(tabId, params) {
  const { x, y, steps = 1 } = params;

  if (x === undefined || y === undefined) {
    throw Object.assign(new Error('Missing required params: x and y'), { code: 'INVALID_PARAMS' });
  }

  if (steps <= 1) {
    await sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
    });
    return { moved: true, x, y };
  }

  // Interpolate from (0, 0) to target with N steps for smooth movement
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const cx = Math.round(x * progress);
    const cy = Math.round(y * progress);

    await sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: cx,
      y: cy,
    });
  }

  return { moved: true, x, y };
}
