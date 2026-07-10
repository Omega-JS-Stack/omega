/**
 * Screenshot Command
 *
 * Captures a screenshot of the page via Page.captureScreenshot.
 */

import { sendCommand } from '../session.js';

/**
 * @param {number} tabId
 * @param {{ format?, quality?, fullPage?, selector? }} params
 */
export default async function screenshot(tabId, params) {
  const format = params.format || 'png';
  const options = { format };

  if (format === 'jpeg' || format === 'webp') {
    options.quality = params.quality || 80;
  }

  // Capture full page by adjusting the viewport
  if (params.fullPage) {
    const metrics = await sendCommand(tabId, 'Page.getLayoutMetrics');
    const { width, height } = metrics.cssContentSize || metrics.contentSize;

    options.clip = {
      x: 0,
      y: 0,
      width,
      height,
      scale: 1,
    };

    options.captureBeyondViewport = true;
  }

  // Capture a specific element
  if (params.selector) {
    const result = await sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(params.selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        };
      })()`,
      returnByValue: true,
    });

    if (!result?.result?.value) {
      throw Object.assign(new Error(`Element not found: ${params.selector}`), { code: 'ELEMENT_NOT_FOUND' });
    }

    const rect = result.result.value;
    options.clip = { ...rect, scale: 1 };
    options.captureBeyondViewport = true;
  }

  const { data } = await sendCommand(tabId, 'Page.captureScreenshot', options);

  return { data, format, encoding: 'base64' };
}
