/**
 * Read Command
 *
 * Reads page content via Runtime.evaluate.
 */

import { sendCommand } from '../session.js';

/**
 * @param {number} tabId
 * @param {{ selector?, expression?, attribute?, property?, all? }} params
 */
export default async function read(tabId, params) {
  // Raw JS expression
  if (params.expression) {
    const result = await sendCommand(tabId, 'Runtime.evaluate', {
      expression: params.expression,
      returnByValue: true,
      awaitPromise: true,
    });

    return { value: result?.result?.value ?? null };
  }

  if (!params.selector) {
    throw Object.assign(new Error('Provide selector or expression'), { code: 'INVALID_PARAMS' });
  }

  // Read attribute
  if (params.attribute) {
    const result = await sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(params.selector)});
        return el ? el.getAttribute(${JSON.stringify(params.attribute)}) : null;
      })()`,
      returnByValue: true,
    });

    return { value: result?.result?.value ?? null };
  }

  // Read property
  if (params.property) {
    const result = await sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(params.selector)});
        return el ? el[${JSON.stringify(params.property)}] : null;
      })()`,
      returnByValue: true,
    });

    return { value: result?.result?.value ?? null };
  }

  // Read all matching elements
  if (params.all) {
    const result = await sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const els = document.querySelectorAll(${JSON.stringify(params.selector)});
        return Array.from(els).map(el => ({
          tagName: el.tagName,
          text: (el.textContent || '').trim().slice(0, 200),
          value: el.value || null,
        }));
      })()`,
      returnByValue: true,
    });

    return { elements: result?.result?.value ?? [] };
  }

  // Default: read text content + inner HTML
  const result = await sendCommand(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(params.selector)});
      if (!el) return null;
      return {
        tagName: el.tagName,
        text: (el.textContent || '').trim().slice(0, 1000),
        html: el.innerHTML.slice(0, 2000),
        value: el.value || null,
      };
    })()`,
    returnByValue: true,
  });

  return { value: result?.result?.value ?? null };
}
