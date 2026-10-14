/**
 * Run a case with the CI flags lifted, so a verb that declines its log tee on
 * a runner (docs/shared/logging.md § CI) writes its log on every machine, and
 * a case reading that log proves the tee instead of skipping where it gates.
 */

const { CI_FLAGS } = require('../ci.js');

/**
 * Delete the CI flags from `process.env`, run `fn`, then put each flag back as
 * it was (an absent flag stays absent), after a returned promise settles.
 *
 * @param {function} fn - The case body, sync or async
 * @returns {*} What `fn` returns; a promise when it returns one
 */
function withoutCI(fn) {
  const saved = CI_FLAGS.map((name) => [name, process.env[name]]);
  const restore = () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };

  for (const name of CI_FLAGS) delete process.env[name];
  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).finally(restore);
  }
  restore();
  return result;
}

module.exports = { withoutCI };
