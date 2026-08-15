/**
 * argv shaping — the one rule about the leading VERB (#229).
 *
 * Every manager invocation now names its command (`omega manage --service=x`),
 * so anything that REBUILDS an invocation from the raw argv — the run
 * summary's copy-pasteable retry line, the company runner's per-brand child
 * args — has to drop that verb first, or it doubles into `omega manage manage`.
 */

/**
 * The argv without its leading command verb. A first entry that starts with
 * `-` is a flag, not a verb, and is left alone.
 *
 * @param {string[]} argv - Raw arguments (process.argv.slice(2) shaped).
 * @returns {string[]} The arguments after the verb.
 */
function stripLeadingVerb(argv) {
  return argv[0] && !argv[0].startsWith('-') ? argv.slice(1) : argv;
}

module.exports = { stripLeadingVerb };
