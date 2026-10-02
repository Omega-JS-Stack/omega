/**
 * The machine half of the omega plugin: what Claude Code on this machine has
 * registered, installed and turned on for the user. Every call into Claude
 * Code goes through the injected runner `execFn(file, args, options)`, which
 * returns stdout and throws on a failed command; the default is execFileSync
 * on the real `claude`. The developer default is set in
 * the user settings file, in the same shape a linked brand's private file
 * carries. No `claude` on the machine means nothing to read or change.
 */
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const { join } = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { compareVersions, parseVersion } = require('@omega.js/devkit/update');

const {
  MARKETPLACE_KEY,
  PLUGIN_KEY,
  MARKETPLACE_NAME,
  LOCAL_MARKETPLACE_NAME,
  PLUGIN_ID,
  LOCAL_PLUGIN_ID,
  PLUGIN_REPO,
  SPARSE_PATHS,
  LOCAL_MANIFEST,
  readSettings,
  writeSettings,
  withLocal,
} = require('./claude-settings.js');

// The line `omega manage` prints while the published copy is not installed.
const INSTALL_HINT = `Claude plugin not installed on this machine. Run: claude plugin marketplace add ${PLUGIN_REPO} && claude plugin install ${PLUGIN_ID}`;

/**
 * Run `claude` on the injected runner.
 *
 * @param {Function} execFn - The runner: `(file, args, options) => stdout`
 * @param {string[]} args - Arguments after `claude`
 * @returns {string} - stdout
 */
function claude(execFn, args) {
  return execFn('claude', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * The user settings file: `CLAUDE_CONFIG_DIR` when set, else `~/.claude`.
 *
 * @returns {string}
 */
function userSettingsFile() {
  return join(process.env.CLAUDE_CONFIG_DIR || join(os.homedir(), '.claude'), 'settings.json');
}

function hasClaude(execFn) {
  try {
    claude(execFn, ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every record the machine reads: the marketplace records, the user-scope
 * installs, and whether the user default is the local copy.
 *
 * @param {Function} execFn - The runner
 * @returns {{ claude: boolean, marketplaces: object[], installs: object[], localDefault: boolean }}
 */
function readMachine(execFn) {
  if (!hasClaude(execFn)) {
    return { claude: false, marketplaces: [], installs: [], localDefault: false };
  }
  const marketplaces = JSON.parse(claude(execFn, ['plugin', 'marketplace', 'list', '--json']));
  const installs = JSON.parse(claude(execFn, ['plugin', 'list', '--json'])).filter((entry) => entry.scope === 'user');
  const { settings } = readSettings(userSettingsFile());
  const localDefault = Boolean(settings
    && settings[MARKETPLACE_KEY]?.[LOCAL_MARKETPLACE_NAME]
    && settings[PLUGIN_KEY]?.[LOCAL_PLUGIN_ID] === true);
  return { claude: true, marketplaces, installs, localDefault };
}

function findRecord(machine, name) {
  return machine.marketplaces.find((record) => record.name === name) || null;
}

function findInstall(machine, id) {
  return machine.installs.find((entry) => entry.id === id) || null;
}

/**
 * The machine-wide state of the omega plugin for this user.
 *
 * @param {{ execFn?: Function }} [options] - execFn: the runner
 * @returns {{ claude: boolean, source: string|null, version: string|null, localDefault: boolean, marketplaces: object[], installs: object[] }}
 *   source: where the `omega` record points (`github`, `directory`, ...);
 *   version: the user-scope `omega@omega` install; localDefault: the user
 *   settings turn the local copy on; marketplaces and installs: the records
 *   read, so the state can be handed to ensureMachinePlugin as `machine`
 */
function machinePluginState({ execFn = execFileSync } = {}) {
  const machine = readMachine(execFn);
  const record = findRecord(machine, MARKETPLACE_NAME);
  const install = findInstall(machine, PLUGIN_ID);
  return {
    ...machine,
    source: record ? record.source : null,
    version: install ? install.version : null,
  };
}

/**
 * Register a marketplace for the user from a new source. A name the user
 * settings already declare from another source refuses the add, so that
 * declaration goes first (taking its install with it); a record only a
 * project declared moves on the add itself.
 */
function registerMarketplace(execFn, name, record, addArgs) {
  if (record) {
    try {
      claude(execFn, ['plugin', 'marketplace', 'remove', name, '--scope', 'user']);
    } catch {
      // Not declared at user scope: the add below moves the record itself.
    }
  }
  claude(execFn, ['plugin', 'marketplace', 'add', ...addArgs]);
}

function isPublishedRecord(record) {
  return Boolean(record) && record.source === 'github' && record.repo === PLUGIN_REPO;
}

/**
 * Install the published copy for the user. An install turns it on for the
 * user, so on a machine whose default is the local copy it goes off again.
 */
function installPublished(execFn, machine) {
  claude(execFn, ['plugin', 'install', PLUGIN_ID, '--scope', 'user']);
  if (machine.localDefault) {
    claude(execFn, ['plugin', 'disable', PLUGIN_ID, '--scope', 'user']);
  }
}

/**
 * The one move of `omega` onto GitHub: the record re-registered from the
 * published repo, and an install the move took with it put back.
 *
 * @param {Function} execFn - The runner
 * @param {object} machine - What readMachine read before the move
 * @returns {string[]} - `registered` or `moved`, then `installed` when put back
 */
function movePublished(execFn, machine) {
  const record = findRecord(machine, MARKETPLACE_NAME);
  registerMarketplace(execFn, MARKETPLACE_NAME, record, [PLUGIN_REPO, '--sparse', ...SPARSE_PATHS]);
  if (!record) {
    return ['registered'];
  }
  if (!findInstall(machine, PLUGIN_ID)) {
    return ['moved'];
  }
  installPublished(execFn, machine);
  return ['moved', 'installed'];
}

/**
 * Is the installed copy behind the family? A version that is not a release
 * number (a commit id from before the plugin carried one) is behind too.
 */
function isBehind(installed, familyVersion) {
  return !parseVersion(installed) || compareVersions(installed, familyVersion) < 0;
}

/**
 * Install or update the published copy for the user: `omega` registered from
 * GitHub (moving a record that points anywhere else), `omega@omega` installed,
 * and an install older than the family updated with the two update commands.
 *
 * @param {{ execFn?: Function, familyVersion?: string, machine?: object }} options
 *   machine: the state already read (machinePluginState's), so the call acts
 *   on it and reads again only after a move
 * @returns {{ claude: boolean, actions: string[] }} - actions: `registered`, `moved`, `installed`, `updated`
 */
function ensureMachinePlugin({ execFn = execFileSync, familyVersion, machine: read }) {
  let machine = read || readMachine(execFn);
  if (!machine.claude) {
    return { claude: false, actions: [] };
  }

  const actions = [];
  if (!isPublishedRecord(findRecord(machine, MARKETPLACE_NAME))) {
    actions.push(...movePublished(execFn, machine));
    machine = readMachine(execFn);
  }

  const install = findInstall(machine, PLUGIN_ID);
  if (!install) {
    installPublished(execFn, machine);
    actions.push('installed');
  } else if (familyVersion && isBehind(install.version, familyVersion)) {
    claude(execFn, ['plugin', 'marketplace', 'update', MARKETPLACE_NAME]);
    claude(execFn, ['plugin', 'update', PLUGIN_ID, '--scope', 'user']);
    actions.push('updated');
  }

  return { claude: true, actions };
}

/**
 * The omega developer's switch. An `omega` record from anywhere but GitHub
 * moves there first, so one name never has two sources. Then `omega-local`
 * is registered at this checkout's manifest, and the user settings turn it on
 * and `omega@omega` off. A live brand still loads the published copy, because
 * its committed settings turn it on over the user default.
 *
 * @param {{ execFn?: Function, monorepoRoot: string }} options
 * @returns {{ claude: boolean, actions: string[], settings: 'written'|'present'|'invalid'|null, warning?: string }}
 *   actions: `moved`, `installed` (the published copy), `registered-local`;
 *   warning: the first line of a failed `claude` call
 */
function ensureLocalDefault({ execFn = execFileSync, monorepoRoot }) {
  const machine = readMachine(execFn);
  if (!machine.claude) {
    return { claude: false, actions: [], settings: null };
  }

  const actions = [];
  let warning = null;
  try {
    const published = findRecord(machine, MARKETPLACE_NAME);
    if (published && !isPublishedRecord(published)) {
      actions.push(...movePublished(execFn, machine));
    }
    const manifest = join(monorepoRoot, LOCAL_MANIFEST);
    const local = findRecord(machine, LOCAL_MARKETPLACE_NAME);
    if (!local || local.source !== 'file' || local.path !== manifest) {
      registerMarketplace(execFn, LOCAL_MARKETPLACE_NAME, local, [manifest]);
      actions.push('registered-local');
    }
  } catch (error) {
    // A failing `claude` is the machine's: the settings still name the local
    // copy, and the caller warns.
    warning = String(error.message).split('\n')[0];
  }

  return { claude: true, actions, settings: writeLocalDefault(monorepoRoot), ...(warning ? { warning } : {}) };
}

/**
 * The user settings turn the local copy of one checkout on and the published
 * copy off. A file that does not parse is never overwritten.
 *
 * @returns {'written'|'present'|'invalid'}
 */
function writeLocalDefault(monorepoRoot) {
  const file = userSettingsFile();
  const { settings } = readSettings(file);
  if (settings === null) {
    return 'invalid';
  }
  const next = withLocal(settings, monorepoRoot);
  if (isDeepStrictEqual(next, settings)) {
    return 'present';
  }
  writeSettings(file, next);
  return 'written';
}

module.exports = {
  INSTALL_HINT,
  machinePluginState,
  ensureMachinePlugin,
  ensureLocalDefault,
};
