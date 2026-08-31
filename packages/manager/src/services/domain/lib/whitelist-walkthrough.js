/**
 * The Namecheap IP-whitelist walkthrough (#698).
 *
 * Namecheap refuses every API call from an IP that is not on its whitelist, so
 * a new machine — or the same machine on a new network — fails the domain
 * service on every run. Rather than warn forever, an interactive walk drives
 * the fix in place: the house open-and-poll idiom gates on Enter, opens the
 * apiaccess ROOT page (enable, key reset and whitelist all live there), names
 * the IP to add, and RE-CHECKS the refused call — ENTER checks now, `s` steps
 * aside.
 *
 * Non-interactive and dry runs never sit here: they print the page and the IP
 * and hand the warn back to the caller, exactly as before.
 */
const chalk = require('chalk').default;
const { openBrowserAndPoll } = require('@omega.js/devkit/flows');
const { canPrompt } = require('../../../lib/run-gates.js');
const { API_ACCESS_URL, isWhitelistError } = require('./namecheap-api.js');

/**
 * Walk the user through whitelisting the caller IP, retrying the refused call
 * until it passes or the user steps aside.
 *
 * @param {Error} error - The rejection (carries `clientIp` from the client).
 * @param {Function} retry - Async () => the refused call, run again.
 * @param {object} [options] - Run options (a dry run or no TTY never prompts).
 * @returns {Promise<{ success: boolean, result?: any, error?: string }>} -
 *   `result` is the retried call's value once Namecheap accepts it; `error` is
 *   the recheck's OWN failure when it got past the whitelist and failed anyway.
 */
async function walkWhitelist(error, retry, options = {}) {
  const { clientIp } = error;

  console.log(`      ${chalk.yellow('⚠')} Namecheap refused this machine's IP ${chalk.cyan(clientIp)} — it is not on the API whitelist`);

  if (!canPrompt(options)) {
    console.log(`      ${chalk.dim(`→ Add it under "Whitelisted IPs" at ${API_ACCESS_URL}, then rerun`)}`);
    return { success: false };
  }

  const result = await openBrowserAndPoll({
    url: API_ACCESS_URL,
    label: 'the Namecheap API access page',
    promptMessage: `Add ${clientIp} under "Whitelisted IPs" (the same page enables API access and resets the key).`,
    waitMessage: 'Rechecking the Namecheap API',
    check: async () => {
      try {
        return { done: true, result: await retry() };
      } catch (retryError) {
        // Still refused — keep waiting. Any other failure is the walk's answer.
        return isWhitelistError(retryError) ? { done: false } : { done: true, error: retryError.message };
      }
    },
    intervalMs: 10000,
    indent: '      ',
  });

  if (result.success) {
    console.log(`      ${chalk.green('✓')} Namecheap accepted the call — the IP is whitelisted`);
    return { success: true, result: result.result };
  }

  // The recheck got PAST the whitelist and failed for its own reason — say so,
  // and hand it back: it is the truer answer, not the stale rejection (#698).
  // The whitelist closer would be false here, so it only prints when the walk
  // really ended on the rejection.
  if (result.error) {
    console.log(`      ${chalk.yellow('⚠')} The recheck failed${chalk.dim(`: ${result.error}`)}`);
    return { success: false, error: result.error };
  }

  console.log(`      ${chalk.dim('⊘ Still refused — rerun once the IP is whitelisted')}`);
  return { success: false };
}

module.exports = { walkWhitelist };
