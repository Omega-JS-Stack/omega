/**
 * Evaluate Command
 *
 * Runs arbitrary JavaScript in the page context.
 */

import { sendCommand } from '../session.js';

/**
 * @param {number} tabId
 * @param {{ expression, returnByValue? }} params
 */
export default async function evaluate(tabId, params) {
  if (!params.expression) {
    throw Object.assign(new Error('Missing required param: expression'), { code: 'INVALID_PARAMS' });
  }

  const result = await sendCommand(tabId, 'Runtime.evaluate', {
    expression: params.expression,
    returnByValue: params.returnByValue !== false,
    awaitPromise: true,
    userGesture: true,
  });

  if (result?.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Evaluation error';
    throw Object.assign(new Error(msg), { code: 'EVAL_ERROR' });
  }

  return { value: result?.result?.value ?? null };
}
