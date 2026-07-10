/**
 * Type Command
 *
 * Dispatches trusted keyboard events to type text.
 */

import { sendCommand } from '../session.js';
import click from './click.js';

// Special key definitions: key -> { key, code, keyCode }
const SPECIAL_KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
};

/**
 * @param {number} tabId
 * @param {{ text, selector?, delay?, clear? }} params
 */
export default async function type(tabId, params) {
  const { text, delay = 0 } = params;

  if (!text && text !== '') {
    throw Object.assign(new Error('Missing required param: text'), { code: 'INVALID_PARAMS' });
  }

  // Focus element by clicking on it
  if (params.selector) {
    await click(tabId, { selector: params.selector, timeout: params.timeout });
  }

  // Clear existing content
  if (params.clear) {
    // Select all
    await sendCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      modifiers: 2, // Ctrl on Windows/Linux, handled by Chrome
      windowsVirtualKeyCode: 65,
    });
    await sendCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      modifiers: 2,
      windowsVirtualKeyCode: 65,
    });

    // Delete selection
    await sendCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
    await sendCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
  }

  // Parse text into tokens: plain characters and {SpecialKey} sequences
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      const end = text.indexOf('}', i);
      if (end !== -1) {
        tokens.push({ key: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    tokens.push({ char: text[i] });
    i++;
  }

  for (const token of tokens) {
    if (token.key) {
      const special = SPECIAL_KEYS[token.key];
      if (!special) {
        throw Object.assign(new Error(`Unknown special key: {${token.key}}`), { code: 'INVALID_PARAMS' });
      }
      await sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: special.key,
        code: special.code,
        windowsVirtualKeyCode: special.keyCode,
      });
      await sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: special.key,
        code: special.code,
        windowsVirtualKeyCode: special.keyCode,
      });
    } else {
      const char = token.char;
      const keyCode = char.toUpperCase().charCodeAt(0);

      await sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: char,
        code: `Key${char.toUpperCase()}`,
        windowsVirtualKeyCode: keyCode,
      });
      await sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'char',
        text: char,
      });
      await sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: char,
        code: `Key${char.toUpperCase()}`,
        windowsVirtualKeyCode: keyCode,
      });
    }

    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { typed: true, length: text.length };
}
