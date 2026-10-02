/**
 * A stand-in for the `claude` CLI over a throwaway config folder, for the
 * machine helper and the verbs that call it.
 *
 * Two doors: `exec`, the injected runner, and a `claude` executable in `binDir`.
 * State lives in files shaped like Claude Code's own (`settings.json`,
 * `plugins/known_marketplaces.json`, `plugins/installed_plugins.json`), so a test
 * reads one outcome whether the code ran a command or wrote the user settings
 * itself. The answers mirror Claude Code 2.1.284, refusals included: `enable` on
 * an enabled plugin, `disable` on one that is not enabled, and a `marketplace add`
 * of a network source that differs from the user settings' declaration all exit 1.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLAUDE_VERSION = '2.1.284 (Claude Code)';
const MUTATING_VERBS = ['add', 'remove', 'rm', 'install', 'i', 'uninstall', 'enable', 'disable', 'update'];
const PUBLISHED_REPO = 'Omega-JS-Stack/omega';

// ─── State files ─────────────────────────────────────────────────────────────

const files = (configDir) => ({
  settings: path.join(configDir, 'settings.json'),
  known: path.join(configDir, 'plugins', 'known_marketplaces.json'),
  installed: path.join(configDir, 'plugins', 'installed_plugins.json'),
  knobs: path.join(configDir, 'fake-claude.json'),
  log: path.join(configDir, 'fake-claude.log'),
});

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/** The name a marketplace source declares, read the way Claude Code reads it: from its manifest. */
function marketplaceName(source) {
  if (source.source === 'github') {
    return source.repo === PUBLISHED_REPO ? 'omega' : source.repo.split('/')[1];
  }
  const manifest = source.source === 'file' ? source.path : path.join(source.path, '.claude-plugin', 'marketplace.json');
  return readJson(manifest).name;
}

// ─── The CLI ─────────────────────────────────────────────────────────────────

/** Positional words and flags; `--sparse` takes every word up to the next flag. */
function parse(tokens) {
  const words = [];
  const flags = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--scope' || token === '-s') {
      flags.scope = tokens[++i];
    } else if (token === '--sparse') {
      flags.sparse = [];
      while (tokens[i + 1] && !tokens[i + 1].startsWith('-')) flags.sparse.push(tokens[++i]);
    } else if (token.startsWith('-')) {
      flags[token.replace(/^-+/, '')] = true;
    } else {
      words.push(token);
    }
  }
  return { words, flags };
}

/**
 * Run one `claude` command against the machine in `configDir`.
 * @param {string} configDir - The throwaway config folder
 * @param {string[]} args - The words after `claude`
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function run(configDir, args) {
  const f = files(configDir);
  fs.mkdirSync(configDir, { recursive: true });
  fs.appendFileSync(f.log, `${JSON.stringify(args)}\n`);

  const ok = (stdout) => ({ status: 0, stdout, stderr: '' });
  const fail = (stderr) => ({ status: 1, stdout: '', stderr });
  const knobs = readJson(f.knobs, {});
  const settings = readJson(f.settings, {});
  const known = readJson(f.known, {});
  const installed = readJson(f.installed, { version: 2, plugins: {} });
  const saveSettings = () => writeJson(f.settings, settings);

  if (args[0] === '--version' || args[0] === '-v') return ok(`${CLAUDE_VERSION}\n`);
  const refused = (knobs.failing || []).find((words) => words.every((word) => args.includes(word)));
  if (refused) return fail(`✘ fake claude: this machine fails "${refused.join(' ')}"\n`);
  if (args[0] !== 'plugin' && args[0] !== 'plugins') return fail(`fake claude: unknown command ${args.join(' ')}\n`);

  const { words, flags } = parse(args.slice(1));
  const [verb, ...rest] = words;
  const scope = flags.scope || 'user';

  if (verb === 'marketplace') {
    const [action, target] = rest;
    if (flags.json && action !== 'list') return fail('error: unknown option \'--json\'\n');
    if (action === 'list') {
      const list = Object.entries(known).map(([name, entry]) => ({ name, ...entry.source, installLocation: entry.installLocation }));
      return ok(flags.json ? JSON.stringify(list, null, 2) : list.map((entry) => `  ❯ ${entry.name}`).join('\n'));
    }
    if (action === 'add') {
      let source;
      if (/^[\w.-]+\/[\w.-]+$/.test(target) && !fs.existsSync(target)) {
        source = { source: 'github', repo: target };
      } else if (fs.existsSync(target)) {
        source = { source: target.endsWith('.json') ? 'file' : 'directory', path: path.resolve(target) };
      } else {
        return fail(`✘ Failed to add marketplace: ${target} is not a valid source\n`);
      }
      if (flags.sparse) source.sparsePaths = flags.sparse;
      const name = marketplaceName(source);
      // A network source must match the one the user settings declare for that name; a local one may re-point it
      const declared = (settings.extraKnownMarketplaces || {})[name];
      if (source.source === 'github' && declared && JSON.stringify(declared.source) !== JSON.stringify(source)) {
        return fail(`✘ Failed to add marketplace: Cannot add marketplace "${name}": its network source differs from the one declared for it in settings (kind, target, or a fetch-shaping field such as headers / ref / path / sparsePaths); the source must match the one declared for this name in settings (or change the declaration).\n`);
      }
      known[name] = { source, installLocation: path.join(configDir, 'plugins', 'marketplaces', name) };
      writeJson(f.known, known);
      settings.extraKnownMarketplaces = { ...settings.extraKnownMarketplaces, [name]: { source } };
      saveSettings();
      return ok(`✔ Successfully added marketplace: ${name} (declared in user settings)\n`);
    }
    if (action === 'update') return ok(`✔ Successfully updated marketplace: ${target || 'all'}\n`);
    if (action === 'remove' || action === 'rm') {
      // The record, its user declaration and its installs all go
      delete known[target];
      writeJson(f.known, known);
      if (settings.extraKnownMarketplaces) delete settings.extraKnownMarketplaces[target];
      saveSettings();
      for (const id of Object.keys(installed.plugins)) if (id.endsWith(`@${target}`)) delete installed.plugins[id];
      writeJson(f.installed, installed);
      return ok(`✔ Successfully removed marketplace: ${target}\n`);
    }
    return fail(`fake claude: unknown marketplace action ${action}\n`);
  }

  if (verb === 'list') {
    const list = [];
    for (const [id, entries] of Object.entries(installed.plugins)) {
      for (const entry of entries) {
        list.push({ id, version: entry.version, scope: entry.scope, enabled: (settings.enabledPlugins || {})[id] === true, installPath: entry.installPath });
      }
    }
    return ok(flags.json ? JSON.stringify(list, null, 2) : list.map((entry) => `  ❯ ${entry.id}`).join('\n'));
  }

  const id = rest[0];
  const marketplace = id && id.split('@')[1];
  // With --json the result line goes to stdout on success AND failure; the exit code is the same.
  const done = (message, extra = {}) => ok(flags.json
    ? `${JSON.stringify({ command: verb, outcome: 'ok', plugin: id, pluginId: id, scope, message, ...extra })}\n`
    : `✔ ${message}\n`);
  const refuse = (message, extra) => ({
    status: 1,
    stdout: flags.json ? `${JSON.stringify({ command: verb, outcome: 'failed', plugin: id, scope, message, ...extra })}\n` : '',
    stderr: `✘ Failed to ${verb} plugin "${id}": ${message}\n`,
  });

  if (verb === 'install' || verb === 'i') {
    if (!known[marketplace]) return refuse(`Plugin not found in marketplace "${marketplace}"`, { failureCode: 'not_found' });
    const version = marketplace === 'omega' ? knobs.published : (knobs.local || knobs.published);
    installed.plugins[id] = [{ scope, version, installPath: path.join(configDir, 'plugins', 'cache', marketplace, version) }];
    writeJson(f.installed, installed);
    if (scope === 'user') {
      settings.enabledPlugins = { ...settings.enabledPlugins, [id]: true };
      saveSettings();
    }
    return done(`Successfully installed plugin: ${id} (scope: ${scope})`, { installedVersion: version });
  }
  if (verb === 'update') {
    if (!installed.plugins[id]) return refuse(`Plugin "${id}" is not installed`, { failureCode: 'not_installed' });
    const oldVersion = installed.plugins[id][0].version;
    installed.plugins[id] = installed.plugins[id].map((entry) => ({ ...entry, version: knobs.published }));
    writeJson(f.installed, installed);
    return done(`Plugin "${id}" updated from ${oldVersion} to ${knobs.published}`, { oldVersion, newVersion: knobs.published });
  }
  if (verb === 'enable' || verb === 'disable') {
    const on = verb === 'enable';
    if (((settings.enabledPlugins || {})[id] === true) === on) {
      return refuse(`Plugin "${id}" is already ${verb}d at ${scope} scope`, { failureCode: 'already_in_goal_state', alreadyInGoalState: true });
    }
    settings.enabledPlugins = { ...settings.enabledPlugins, [id]: on };
    saveSettings();
    return done(`Successfully ${verb}d plugin: ${id} (scope: ${scope})`);
  }
  if (verb === 'uninstall' || verb === 'remove') {
    delete installed.plugins[id];
    writeJson(f.installed, installed);
    return done(`Successfully uninstalled plugin: ${id}`);
  }
  return fail(`fake claude: unknown plugin verb ${verb}\n`);
}

// ─── The two doors ───────────────────────────────────────────────────────────

/** The words of one call, in any of the runner shapes: `'claude a b'`, `['a', 'b']`, `('claude', ['a', 'b'])`. */
function words(first, second) {
  if (Array.isArray(first)) return first;
  if (Array.isArray(second)) return [first, ...second];
  return String(first).match(/"[^"]*"|'[^']*'|\S+/g).map((word) => word.replace(/^["']|["']$/g, ''));
}

/**
 * A fresh machine in a temp config folder.
 * @param {object} [seed]
 * @param {boolean} [seed.missing] - `claude` is not on the machine at all
 * @param {object} [seed.marketplaces] - name to source object, registered for the user
 * @param {object} [seed.installed] - plugin id to installed version, user scope, enabled
 * @param {object} [seed.enabled] - enabledPlugins written over the installs' own flags
 * @param {string} [seed.published] - the version an install or update of `omega@omega` fetches
 * @param {string[][]} [seed.failing] - commands that exit 1, each named by words it carries
 */
function createMachine({ missing = false, marketplaces = {}, installed = {}, enabled = {}, published = '1.0.0', failing = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fake-claude-'));
  const configDir = path.join(root, 'config');
  const binDir = path.join(root, 'bin');
  const f = files(configDir);
  fs.mkdirSync(binDir, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));

  writeJson(f.knobs, { published, failing });
  const known = {};
  for (const [name, source] of Object.entries(marketplaces)) {
    known[name] = { source, installLocation: path.join(configDir, 'plugins', 'marketplaces', name) };
  }
  if (Object.keys(known).length) writeJson(f.known, known);
  if (Object.keys(installed).length) {
    const plugins = {};
    for (const [id, version] of Object.entries(installed)) {
      plugins[id] = [{ scope: 'user', version, installPath: path.join(configDir, 'plugins', 'cache', id, version) }];
    }
    writeJson(f.installed, { version: 2, plugins });
  }
  const enabledPlugins = { ...Object.fromEntries(Object.keys(installed).map((id) => [id, true])), ...enabled };
  const declared = Object.fromEntries(Object.entries(marketplaces).map(([name, source]) => [name, { source }]));
  if (Object.keys(declared).length || Object.keys(enabledPlugins).length) {
    writeJson(f.settings, {
      ...(Object.keys(declared).length ? { extraKnownMarketplaces: declared } : {}),
      ...(Object.keys(enabledPlugins).length ? { enabledPlugins } : {}),
    });
  }

  if (!missing) {
    const script = path.join(binDir, 'claude');
    fs.writeFileSync(script, `#!/bin/sh\nexec "${process.execPath}" "${__filename}" "${configDir}" "$@"\n`, { mode: 0o755 });
  }

  /** The injected runner: stdout as a string, a throw on a non-zero exit (the execSync contract). */
  function exec(first, second, third) {
    const callback = [second, third].find((arg) => typeof arg === 'function');
    const argv = words(first, typeof second === 'function' ? undefined : second);
    const settle = (error, stdout) => {
      if (callback) return callback(error, stdout, error ? error.stderr : '');
      if (error) throw error;
      return stdout;
    };
    const lookup = argv[0] === 'which' || (argv[0] === 'command' && argv[1] === '-v');
    if (missing) {
      const error = Object.assign(new Error(`spawn ${lookup ? argv.at(-1) : argv[0]} ENOENT`), { code: 'ENOENT', errno: -2, status: 127, stdout: '', stderr: 'command not found: claude\n' });
      return settle(error);
    }
    if (lookup) return settle(null, `${path.join(binDir, 'claude')}\n`);
    const result = run(configDir, argv[0] === 'claude' ? argv.slice(1) : argv);
    if (result.status !== 0) {
      return settle(Object.assign(new Error(`Command failed: claude ${argv.join(' ')}\n${result.stderr}`), result));
    }
    return settle(null, result.stdout);
  }

  /** Every call so far, as the words after `claude`. */
  const calls = () => (fs.existsSync(f.log) ? fs.readFileSync(f.log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

  return {
    configDir,
    binDir,
    exec,
    calls,
    /** The calls that change the machine (every list, version and lookup dropped). */
    mutations: () => calls().filter((argv) => argv.some((word) => MUTATING_VERBS.includes(word)) && !argv.includes('list')),
    /** The machine as Claude Code would read it: the source records, the user settings, the installs. */
    state: () => ({
      records: readJson(f.known, {}),
      settings: readJson(f.settings, {}),
      installed: readJson(f.installed, { plugins: {} }).plugins,
    }),
    /**
     * Point this process (and every child it spawns) at this machine: its
     * config folder, and a PATH whose only `claude` is the fake (none at all
     * when it is missing). Returns the undo.
     */
    activate() {
      const previous = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, PATH: process.env.PATH };
      const others = process.env.PATH.split(path.delimiter).filter((dir) => !fs.existsSync(path.join(dir, 'claude')));
      process.env.CLAUDE_CONFIG_DIR = configDir;
      process.env.PATH = [binDir, ...others].join(path.delimiter);
      return () => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      };
    },
  };
}

if (require.main === module) {
  const result = run(process.argv[2], process.argv.slice(3));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status;
}

module.exports = { createMachine, CLAUDE_VERSION };
