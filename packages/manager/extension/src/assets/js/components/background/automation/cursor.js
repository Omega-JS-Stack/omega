/**
 * @file Visual cursor overlay for automation
 *
 * Injects a crosshair element into the page that follows CDP mouse events.
 * Injected on debugger attach, removed on detach. The cursor shows a brief
 * "pulse" animation on click for visual feedback.
 */

import { sendCommand } from './session.js';

const CURSOR_ID = '__omega_cursor__';

const CURSOR_CSS = `
  #${CURSOR_ID} {
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
    width: 20px;
    height: 20px;
    transform: translate(-50%, -50%);
    transition: left 0.08s ease-out, top 0.08s ease-out;
    left: -100px;
    top: -100px;
  }
  #${CURSOR_ID}::before,
  #${CURSOR_ID}::after {
    content: '';
    position: absolute;
    background: rgba(255, 50, 50, 0.9);
    border-radius: 1px;
  }
  #${CURSOR_ID}::before {
    width: 2px;
    height: 20px;
    left: 50%;
    top: 0;
    transform: translateX(-50%);
  }
  #${CURSOR_ID}::after {
    width: 20px;
    height: 2px;
    top: 50%;
    left: 0;
    transform: translateY(-50%);
  }
  #${CURSOR_ID} .omega-cursor-dot {
    position: absolute;
    width: 6px;
    height: 6px;
    background: rgba(255, 50, 50, 0.9);
    border-radius: 50%;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
  #${CURSOR_ID} .omega-cursor-ring {
    position: absolute;
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 50, 50, 0.6);
    border-radius: 50%;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0);
    opacity: 0;
  }
  #${CURSOR_ID}.omega-cursor-click .omega-cursor-ring {
    animation: omega-cursor-pulse 0.4s ease-out;
  }
  @keyframes omega-cursor-pulse {
    0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
  }
`;

const CURSOR_HTML = `
  <div class="omega-cursor-dot"></div>
  <div class="omega-cursor-ring"></div>
`;

/**
 * Inject the cursor overlay into a tab.
 */
export async function inject(tabId) {
  await sendCommand(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      if (document.getElementById('${CURSOR_ID}')) return;
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(CURSOR_CSS)};
      document.head.appendChild(style);
      const el = document.createElement('div');
      el.id = '${CURSOR_ID}';
      el.innerHTML = ${JSON.stringify(CURSOR_HTML)};
      document.body.appendChild(el);
    })()`,
  });
}

/**
 * Move the cursor to a position.
 */
export async function move(tabId, x, y) {
  await sendCommand(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      const el = document.getElementById('${CURSOR_ID}');
      if (!el) return;
      el.style.left = '${x}px';
      el.style.top = '${y}px';
    })()`,
  });
}

/**
 * Trigger the click pulse animation.
 */
export async function pulse(tabId) {
  await sendCommand(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      const el = document.getElementById('${CURSOR_ID}');
      if (!el) return;
      el.classList.remove('omega-cursor-click');
      void el.offsetWidth;
      el.classList.add('omega-cursor-click');
    })()`,
  });
}

/**
 * Remove the cursor overlay from a tab.
 */
export async function remove(tabId) {
  try {
    await sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const el = document.getElementById('${CURSOR_ID}');
        if (el) el.remove();
      })()`,
    });
  } catch {
    // Tab may already be closed
  }
}
