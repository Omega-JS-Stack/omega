// test/_init.js: the pre-test lifecycle hook, one loader for every runner that
// honors it (the devkit runner, runner-core, web's test command).
//
// A test root may carry `_init.js` exporting a factory,
// `module.exports = ({ projectRoot, ...factoryArgs }) => ({ setup(ctx), ...data })`.
// Its `setup` runs ONCE before any case. A hook that cannot load or set up
// throws an InitHookError naming the file: a broken hook fails the run.

const path = require('path');
const jetpack = require('fs-jetpack');

class InitHookError extends Error {
  /**
   * @param {string} file - The `_init.js` that failed.
   * @param {string} problem - What went wrong, in a few words.
   * @param {*} [cause] - The underlying error, when there is one.
   */
  constructor(file, problem, cause) {
    const because = cause === undefined ? '' : `: ${cause && cause.message ? cause.message : cause}`;
    super(`${file} ${problem}${because}`, cause === undefined ? undefined : { cause });
    this.name = 'InitHookError';
    this.file = file;
  }
}

/**
 * Load every root's `_init.js` and call its factory.
 * @param {Array<{dir: string, label: string}>} roots - Test dirs, in run order.
 * @param {{projectRoot: string, factoryArgs?: object}} options - Handed to each factory.
 * @returns {Array<{file: string, label: string, hook: object}>} One entry per root that has the file.
 */
function loadInitHooks(roots, { projectRoot, factoryArgs = {} }) {
  const hooks = [];

  for (const { dir, label } of roots) {
    const file = path.join(dir, '_init.js');
    if (!jetpack.exists(file)) continue;

    let factory;
    try {
      delete require.cache[require.resolve(file)];
      factory = require(file);
    } catch (e) {
      throw new InitHookError(file, 'failed to load', e);
    }

    if (typeof factory !== 'function') {
      throw new InitHookError(file, 'must export a factory: module.exports = ({ projectRoot }) => ({ setup(ctx) { } })');
    }

    let hook;
    try {
      hook = factory({ projectRoot, ...factoryArgs });
    } catch (e) {
      throw new InitHookError(file, 'factory threw', e);
    }

    if (!hook || typeof hook !== 'object') {
      throw new InitHookError(file, 'factory must return an object: ({ setup(ctx) { } })');
    }

    hooks.push({ file, label, hook });
  }

  return hooks;
}

/**
 * Load the hooks, then await each `setup` once, in root order.
 * @param {Array<{dir: string, label: string}>} roots - Test dirs, in run order.
 * @param {string} projectRoot - Handed to every factory and every setup.
 * @param {{factoryArgs?: object, setupContext?: Function}} [options] - `setupContext({ hooks })` adds keys to each setup's ctx.
 * @returns {Promise<Array<{file: string, label: string, hook: object}>>} The loaded hooks.
 */
async function runInitSetups(roots, projectRoot, { factoryArgs, setupContext } = {}) {
  const hooks = loadInitHooks(roots, { projectRoot, factoryArgs });

  for (const { file, hook } of hooks) {
    if (typeof hook.setup !== 'function') continue;
    const extra = setupContext ? await setupContext({ hooks }) : {};
    try {
      await hook.setup({ projectRoot, ...extra });
    } catch (e) {
      throw new InitHookError(file, 'setup failed', e);
    }
  }

  return hooks;
}

module.exports = { loadInitHooks, runInitSetups, InitHookError };
