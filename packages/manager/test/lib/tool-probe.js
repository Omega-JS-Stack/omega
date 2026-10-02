/**
 * The one test runner handed in as `options.execFn`, which runs `gh`, `claude`
 * and the machine-tool probes alike. A machine-tool probe (java, firebase)
 * throws for a tool a case names missing and passes otherwise, so no test
 * reaches the real tool; every other file runs for real, which the PATH fakes
 * (fake-gh, fake-claude) answer.
 */
const { execFileSync } = require('node:child_process');
const { MACHINE_TOOLS } = require('@omega.js/devkit/machine-tools');

// The probe's file to its tool's name: `java` to java, `firebase` to firebase
const TOOL_OF_PROBE = Object.fromEntries(Object.values(MACHINE_TOOLS).flat().map((tool) => [tool.probe[0], tool.name]));

/**
 * A runner whose machine-tool probes fail for the tools named `missing`.
 * @param {...string} missing - Tool names whose probe throws, as a failed probe does
 * @returns {(file: string, args: string[], options: object) => string|Buffer}
 */
function toolProbe(...missing) {
  return (file, args, options) => {
    if (!(file in TOOL_OF_PROBE)) return execFileSync(file, args, options);
    if (missing.includes(TOOL_OF_PROBE[file])) throw Object.assign(new Error(`spawnSync ${file} ENOENT`), { code: 'ENOENT' });
    return '';
  };
}

module.exports = { toolProbe };
