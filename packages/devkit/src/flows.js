/**
 * Interactive terminal flows — browser-open and wait/poll loops, TTY-safe
 * like prompt.js. omega-manager's terminal-utils ported: openBrowserAndPoll
 * drives the "do something in a browser, poll the API until it shows up"
 * onboarding flows; pollWithSpinner is the wait half on its own; withSpinner
 * wraps a slow call in a live spinner.
 *
 * Degradation without a TTY (CI, company-mode children, node --test):
 * nothing prompts, nothing draws — openBrowserAndPoll prints the URL and
 * skips; pollWithSpinner polls quietly (or skips when manualOnly);
 * withSpinner prints one line instead of animating.
 *
 * Test seams: streams ride prompt.js's setPromptStreams (keypresses in,
 * spinner + prompt output out — real keystrokes, no mocks), and
 * setBrowserOpener(fn) replaces the platform browser launcher so tests
 * never open a real browser.
 */
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const chalk = require('chalk').default;
const { input, isInteractive, getPromptStreams, enterToOpenMessage } = require('./prompt.js');

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

let _opener = null;

/**
 * Replace the platform browser launcher (test seam). Pass null to restore.
 */
function setBrowserOpener(fn) {
  _opener = fn || null;
}

function platformOpener(url) {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];

  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
    child.once('error', () => resolve(false));
  });
}

/**
 * Open a URL in the default browser. Resolves false when no launcher is
 * available (callers always print the URL first, so failure just means
 * the user clicks it themselves).
 *
 * @param {string} url - URL to open
 * @returns {Promise<boolean>} - Whether a browser launch was started
 */
function openBrowser(url) {
  return (_opener || platformOpener)(url);
}

/**
 * Run an async function with a live spinner (one static line without a TTY).
 *
 * @param {string} message - Message to display while waiting
 * @param {Function} fn - Async function to execute
 * @param {Object} [options]
 * @param {string} [options.indent] - Indentation prefix
 * @returns {any} - Result of fn()
 */
async function withSpinner(message, fn, options = {}) {
  const { indent = '      ' } = options;
  const { output } = getPromptStreams();

  if (!isInteractive()) {
    output.write(`${indent}${message}...\n`);
    return fn();
  }

  let spinnerIndex = 0;
  const startTime = Date.now();

  const interval = setInterval(() => {
    const frame = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length];
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    output.write(`\r${indent}${frame} ${message}... (${elapsed}s)`);
    spinnerIndex++;
  }, 100);

  try {
    return await fn();
  } finally {
    clearInterval(interval);
    output.write('\r' + ' '.repeat(70) + '\r');
  }
}

/**
 * Poll until a condition is met, with a spinner and keyboard controls
 * (ENTER = check now — or "I'm done" when manualOnly; S = skip waiting).
 *
 * Without a TTY there are no keys and no spinner: manualOnly returns
 * skipped immediately (nobody can press ENTER), API-checked polls run
 * quietly on the interval.
 *
 * @param {Object} options
 * @param {Function} options.check - Async () => { done: boolean, result?: any, error?: string }
 * @param {number} [options.intervalMs] - Interval between checks (default: 10000)
 * @param {string} [options.message] - Message to display while waiting
 * @param {string} [options.indent] - Indentation prefix
 * @param {boolean} [options.manualOnly] - No API check available; just wait for ENTER
 * @returns {Promise<{ success: boolean, result?: any, error?: string, skipped?: boolean }>}
 */
async function pollWithSpinner(options) {
  const {
    check,
    intervalMs = 10000,
    message = 'Waiting',
    indent = '        ',
    manualOnly = false,
  } = options;

  const { input, output } = getPromptStreams();

  // Non-interactive: no keys, no spinner
  if (!isInteractive()) {
    if (manualOnly) {
      output.write(`${indent}${chalk.dim('⊘ Non-interactive — cannot wait for manual confirmation')}\n`);
      return { success: false, skipped: true };
    }

    output.write(`${indent}${message}... ${chalk.dim(`(checking every ${Math.round(intervalMs / 1000)}s)`)}\n`);
    while (true) {
      try {
        const result = await check();
        if (result.done) {
          if (result.error) {
            return { success: false, error: result.error };
          }
          return { success: true, result: result.result };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  output.write(`\n${indent}${chalk.dim(`(enter)=${manualOnly ? 'done' : 'check now'}, (s)=skip`)}\n\n`);

  let spinnerIndex = 0;
  let lastCheck = Date.now();
  let checkNow = false;
  let skip = false;

  // Keyboard input on the effective stream (fake TTYs in tests lack
  // setRawMode — a stream-level capability, not something we own)
  readline.emitKeypressEvents(input);
  input.setRawMode?.(true);
  input.resume();

  const keypressHandler = (ch, key) => {
    if (key?.name === 'return') {
      checkNow = true;
    } else if (ch?.toLowerCase() === 's') {
      skip = true;
    } else if (key?.ctrl && key?.name === 'c') {
      process.exit();
    }
  };
  input.on('keypress', keypressHandler);

  const startTime = Date.now();
  const spinnerInterval = setInterval(() => {
    const frame = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length];
    if (manualOnly) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      output.write(`\r${indent}${frame} ${message}... (${elapsed}s)`);
    } else {
      const elapsed = Math.floor((Date.now() - lastCheck) / 1000);
      const remaining = Math.max(0, intervalMs / 1000 - elapsed);
      output.write(`\r${indent}${frame} ${message}... (${remaining}s)`);
    }
    spinnerIndex++;
  }, 100);

  const cleanup = () => {
    clearInterval(spinnerInterval);
    output.write('\r' + ' '.repeat(70) + '\r');
    // Only remove OUR keypress listener (inquirer manages its own)
    input.removeListener('keypress', keypressHandler);
    input.setRawMode?.(false);
    input.pause();
  };

  try {
    while (true) {
      if (skip) {
        cleanup();
        return { success: false, skipped: true };
      }

      // In manual mode, ENTER means "I'm done" — success immediately
      if (manualOnly && checkNow) {
        cleanup();
        return { success: true };
      }

      if (!manualOnly) {
        try {
          const result = await check();
          if (result.done) {
            cleanup();
            if (result.error) {
              return { success: false, error: result.error };
            }
            return { success: true, result: result.result };
          }
        } catch (error) {
          cleanup();
          return { success: false, error: error.message };
        }
      }

      // Wait for the next interval — or until a key cuts it short
      lastCheck = Date.now();
      checkNow = false;

      await new Promise((resolve) => {
        let timer = null;
        const keyPoll = setInterval(() => {
          if (checkNow || skip) {
            clearInterval(keyPoll);
            clearTimeout(timer);
            resolve();
          }
        }, 100);
        // In manual mode there's no auto-check — only user input resolves
        if (!manualOnly) {
          timer = setTimeout(() => {
            clearInterval(keyPoll);
            resolve();
          }, intervalMs);
        }
      });
    }
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * Print instructions + a URL, open the browser (Enter-gated), and poll
 * until the condition is met. The core onboarding-flow shape: "create the
 * thing in this dashboard; I'll wait until I can see it via the API."
 *
 * Without a TTY the URL is printed and the flow returns skipped.
 *
 * The open is gated behind Enter — the ONE synonymous walkthrough gate
 * (prompt.js enterToOpenMessage); skipping the step happens at the poll
 * via (s), never by declining the open.
 *
 * @param {Object} options
 * @param {string} options.url - URL to open
 * @param {string} options.promptMessage - What needs to be done there
 * @param {string} [options.label] - What the Enter gate calls the page
 * @param {string} options.waitMessage - Message shown while polling
 * @param {Function} [options.check] - Async condition (see pollWithSpinner)
 * @param {number} [options.intervalMs] - Poll interval (default: 10000)
 * @param {string} [options.indent] - Indentation prefix
 * @param {boolean} [options.manualOnly] - No API check; wait for ENTER
 * @returns {Promise<{ success: boolean, result?: any, error?: string, skipped?: boolean }>}
 */
async function openBrowserAndPoll(options) {
  const {
    url,
    promptMessage,
    label = 'this page',
    waitMessage,
    check,
    intervalMs = 10000,
    indent = '        ',
    manualOnly = false,
  } = options;

  const { output } = getPromptStreams();

  output.write(`\n${indent}${promptMessage}\n${indent}URL: ${chalk.cyan(url)}\n\n`);

  if (!isInteractive()) {
    output.write(`${indent}${chalk.dim('⊘ Non-interactive — skipping browser open + poll')}\n`);
    return { success: false, skipped: true };
  }

  await input({ message: enterToOpenMessage(label) });

  const opened = await openBrowser(url);
  if (!opened) {
    output.write(`${indent}${chalk.dim("(couldn't launch a browser — open the URL above manually)")}\n`);
  }

  return pollWithSpinner({
    check,
    intervalMs,
    message: waitMessage,
    indent,
    manualOnly,
  });
}

module.exports = {
  openBrowser,
  setBrowserOpener,
  withSpinner,
  pollWithSpinner,
  openBrowserAndPoll,
};
