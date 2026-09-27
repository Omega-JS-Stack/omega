/**
 * target-picker: the ONE spelling and parse of the root picker, `--target=<a,b>`.
 * A brand root picks targets with it and the monorepo root picks packages with
 * it, so the flag name and its comma list can never drift between the two.
 * Stdlib-free: the dispatcher that requires it is vendored into every framework dist.
 */

// The flag that spells the picker on every root verb
const PICKER_FLAG = 'target';

/**
 * A comma list of target tokens, trimmed and emptied of blanks.
 *
 * @param {string} [value] - the raw flag value
 * @returns {string[]}
 */
function parseTargetTokens(value) {
  return String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
}

/**
 * Split the picker (`--target=a,b` or `--target a,b`) out of raw args, keeping
 * every other arg verbatim and in order: those are the ones that forward.
 *
 * @param {string[]} args - raw args, as typed
 * @returns {{ tokens: string[], rest: string[] }}
 */
function takePicker(args) {
  const tokens = [];
  const rest = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith(`--${PICKER_FLAG}=`)) {
      tokens.push(...parseTargetTokens(arg.slice(PICKER_FLAG.length + 3)));
    } else if (arg === `--${PICKER_FLAG}`) {
      tokens.push(...parseTargetTokens(args[index + 1]));
      index++;
    } else {
      rest.push(arg);
    }
  }
  return { tokens, rest };
}

module.exports = { PICKER_FLAG, parseTargetTokens, takePicker };
