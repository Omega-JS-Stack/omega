/**
 * The machine tools each target type needs that npm does not install: the ONE
 * list, and the one helper that names what an enabled set of targets misses.
 *
 * A brand is checked only for the targets it has turned on. A miss is one
 * line (the tool, the target that needs it, the command that installs it):
 * the wizard, `omega dev`, `omega manage` and `omega status` name it and go
 * on, and only a command that cannot run without the tool refuses with it.
 */
const { execFileSync } = require('child_process');
const { backendProjectType } = require('@omega.js/config');

// Each probe RUNS the tool and reads its exit code: macOS ships a `java` stub
// that is on the PATH with no runtime behind it, so a PATH lookup would pass.
const JAVA = {
  name: 'java',
  probe: ['java', '-version'],
  why: 'the Firebase emulators run on it',
  install: {
    darwin: 'brew install openjdk',
    win32: 'winget install Microsoft.OpenJDK.21. Chocolatey works too: choco install openjdk.',
    linux: 'sudo apt install default-jdk',
  },
};

const FIREBASE = {
  name: 'firebase',
  probe: ['firebase', '--version'],
  why: 'the emulators and the deploy call it',
  install: {
    darwin: 'npm install -g firebase-tools',
    win32: 'npm install -g firebase-tools',
    linux: 'npm install -g firebase-tools',
  },
};

// Per target type. An install line OPENS with something a person can paste;
// an alternative follows in a sentence, never spliced into the command.
const MACHINE_TOOLS = {
  backend: [JAVA, FIREBASE],
  web: [],
  desktop: [],
  extension: [],
};

/**
 * The machine tools one target needs. A custom backend runs its own server
 * with no emulator and no Firebase deploy, and a type with no list (mobile,
 * custom) needs nothing npm does not bring.
 *
 * @param {{ type: string, projectType?: string }} target - A target entry
 * @returns {Array<object>} Its MACHINE_TOOLS entries
 */
function machineToolsFor(target) {
  if (target.type === 'backend' && backendProjectType(target) === 'custom') return [];
  return MACHINE_TOOLS[target.type] || [];
}

/**
 * The tools an enabled set of targets is missing: one row per missing tool per
 * target. Each tool is probed once per call, and only when a target needs it.
 *
 * @param {Array<{ name: string, type: string, projectType?: string }>} targets - The enabled targets
 * @param {object} [options]
 * @param {string} [options.platform] - Host platform, which picks the install line (test seam)
 * @param {function} [options.execFn] - execFileSync; a throw is a missing tool (test seam)
 * @returns {Array<{ target: string, type: string, name: string, why: string, install: string }>}
 */
function missingMachineTools(targets, { platform = process.platform, execFn = execFileSync } = {}) {
  const installed = new Map();
  const isInstalled = (tool) => {
    if (!installed.has(tool.name)) {
      const [file, ...args] = tool.probe;
      try {
        // A Windows .cmd shim (firebase) resolves only through a shell
        execFn(file, args, { stdio: 'ignore', shell: process.platform === 'win32' });
        installed.set(tool.name, true);
      } catch {
        installed.set(tool.name, false);
      }
    }
    return installed.get(tool.name);
  };

  return targets.flatMap((target) => machineToolsFor(target)
    .filter((tool) => !isInstalled(tool))
    .map((tool) => ({ target: target.name, type: target.type, name: tool.name, why: tool.why, install: tool.install[platform] || tool.install.linux })));
}

/**
 * The one line a miss is named in.
 *
 * @param {{ target: string, name: string, why: string, install: string }} miss - A missingMachineTools row
 * @returns {string}
 */
function machineToolLine(miss) {
  return `${miss.name} is not installed (the ${miss.target} target needs it: ${miss.why}). Install with: ${miss.install}`;
}

module.exports = { MACHINE_TOOLS, machineToolsFor, missingMachineTools, machineToolLine };
