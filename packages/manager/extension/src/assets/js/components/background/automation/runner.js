/**
 * Automation Runner
 *
 * Executes single commands or sequences of commands.
 * Manages debugger sessions and dispatches to command handlers.
 */

import * as session from './session.js';
import click from './commands/click.js';
import type from './commands/type.js';
import mouse from './commands/mouse.js';
import navigate from './commands/navigate.js';
import wait from './commands/wait.js';
import read from './commands/read.js';
import scroll from './commands/scroll.js';
import evaluate from './commands/evaluate.js';
import screenshot from './commands/screenshot.js';
import tabs from './commands/tabs.js';

const COMMANDS = { click, type, mouse, navigate, wait, read, scroll, evaluate, screenshot, tabs };

// Commands that don't require a debugger session
const SESSION_FREE = new Set(['tabs']);

/**
 * Handle any automation message from the WebSocket
 */
export async function handleAutomation(message) {
  const { type: msgType, id } = message;

  try {
    if (msgType === 'OMEGA_AUTOMATE_SESSION') {
      return await handleSession(message);
    }

    if (msgType === 'OMEGA_AUTOMATE') {
      return await handleSingleCommand(message);
    }

    if (msgType === 'OMEGA_AUTOMATE_SEQUENCE') {
      return await handleSequence(message);
    }

    return {
      type: 'OMEGA_AUTOMATE_RESULT',
      id,
      success: false,
      error: { code: 'UNKNOWN_TYPE', message: `Unknown message type: ${msgType}` },
    };
  } catch (error) {
    return {
      type: 'OMEGA_AUTOMATE_RESULT',
      id,
      success: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Handle session management (attach/detach/list)
 */
async function handleSession(message) {
  const { id, action, target } = message;

  if (action === 'list') {
    return {
      type: 'OMEGA_AUTOMATE_RESULT',
      id,
      success: true,
      result: { sessions: session.listSessions() },
    };
  }

  if (action === 'attach') {
    const tabId = await session.resolveTarget(target);
    await session.attach(tabId);

    return {
      type: 'OMEGA_AUTOMATE_RESULT',
      id,
      success: true,
      result: { tabId, attached: true },
    };
  }

  if (action === 'detach') {
    if (target?.tabId) {
      await session.detach(target.tabId);
    } else {
      await session.detachAll();
    }

    return {
      type: 'OMEGA_AUTOMATE_RESULT',
      id,
      success: true,
      result: { detached: true },
    };
  }

  return {
    type: 'OMEGA_AUTOMATE_RESULT',
    id,
    success: false,
    error: { code: 'INVALID_PARAMS', message: `Unknown session action: ${action}` },
  };
}

/**
 * Execute a single command
 */
async function handleSingleCommand(message) {
  const { id, command, params = {}, target } = message;

  const handler = COMMANDS[command];

  if (!handler) {
    return {
      type: 'OMEGA_AUTOMATE_RESULT',
      id,
      success: false,
      error: { code: 'UNKNOWN_COMMAND', message: `Unknown command: ${command}` },
    };
  }

  // Session-free commands skip target resolution and debugger attach
  if (SESSION_FREE.has(command)) {
    const result = await handler(null, params);
    return {
      type: 'OMEGA_AUTOMATE_RESULT',
      id,
      success: true,
      result,
    };
  }

  // Resolve target tab and ensure debugger is attached
  const tabId = await session.resolveTarget(target);
  await session.ensureAttached(tabId);

  const result = await handler(tabId, params);

  return {
    type: 'OMEGA_AUTOMATE_RESULT',
    id,
    success: true,
    result: { ...result, tabId },
  };
}

/**
 * Execute a sequence of commands
 */
async function handleSequence(message) {
  const { id, steps, target } = message;

  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    return {
      type: 'OMEGA_AUTOMATE_RESULT',
      id,
      success: false,
      error: { code: 'INVALID_PARAMS', message: 'Sequence requires a non-empty steps array' },
    };
  }

  // Resolve target tab and ensure debugger is attached
  const tabId = await session.resolveTarget(target);
  await session.ensureAttached(tabId);

  const results = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const handler = COMMANDS[step.command];

    if (!handler) {
      return {
        type: 'OMEGA_AUTOMATE_RESULT',
        id,
        success: false,
        error: { code: 'UNKNOWN_COMMAND', message: `Unknown command: ${step.command}`, step: i },
        results,
      };
    }

    try {
      const stepTabId = SESSION_FREE.has(step.command) ? null : tabId;
      const result = await handler(stepTabId, step.params || {});
      results.push({ step: i, command: step.command, success: true, result });

      // Send progress back through background -> offscreen -> WebSocket
      chrome.runtime.sendMessage({
        action: 'automateProgress',
        data: {
          type: 'OMEGA_AUTOMATE_PROGRESS',
          id,
          step: i,
          totalSteps: steps.length,
          command: step.command,
          status: 'completed',
          result,
        },
      }).catch(() => {
        // Progress messages are fire-and-forget
      });
    } catch (error) {
      results.push({ step: i, command: step.command, success: false, error: error.message });

      return {
        type: 'OMEGA_AUTOMATE_RESULT',
        id,
        success: false,
        error: {
          code: error.code || 'STEP_FAILED',
          message: error.message,
          step: i,
          command: step.command,
        },
        results,
      };
    }
  }

  return {
    type: 'OMEGA_AUTOMATE_RESULT',
    id,
    success: true,
    result: { tabId, stepsCompleted: steps.length },
    results,
  };
}
