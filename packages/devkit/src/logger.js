// Build-time logger — timestamped, tag-scoped console output for CLI commands, gulp
// tasks, and test runners. `new Logger('setup')` then logger.log/error/warn/info,
// which prints `[HH:MM:SS] [@omega.js/<package>:setup] message`.
//
// NOT for app/runtime logging — frameworks with runtime logging needs (e.g. desktop's
// Electron file-transport logger-lite) keep their own, and emit the same tag WITHOUT
// the timestamp (devtools stamps runtime lines).

// Libraries
const chalk = require('chalk').default;
const path = require('path');
// Plain fs, not fs-jetpack: this module is VENDORED into every framework, and
// vendoring requires the host to declare each runtime dependency the vendored
// code uses (tools/vendor.js) — a logger must not push a dep onto its hosts.
const fs = require('fs');

// The one identity tag: [@omega.js/<package>:<module>]. The package segment is
// derived from the file that CONSTRUCTED the logger — call sites stay
// `new Logger('setup')` and never name their own package.
//
// KNOWN LIMIT: the derivation reports whatever package owns the constructing
// file, so a CONSUMER file constructing one (a brand's own build script, a
// consumer hook) would stamp the consumer's package name — e.g.
// `[my-brand:deploy]`, not `[@omega.js/web:deploy]`. That is arguably the honest
// answer (the line really does come from consumer code), and no such call site
// exists today: every construction is inside a framework here or in its vendored
// dist copy. It stays a documented limit rather than a check because the repo
// guard (scripts/log-tags.test.js) cannot see consumer trees at all.
const FALLBACK_PACKAGE = '@omega.js/devkit';

// Cache the directory → package-name lookup; a build constructs many loggers.
const packageNameCache = new Map();

// Walk up from a directory to the nearest package.json and read its name.
function findPackageName(startDir) {
  if (packageNameCache.has(startDir)) {
    return packageNameCache.get(startDir);
  }

  let name = null;
  let dir = startDir;
  while (true) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (manifest && manifest.name) {
        name = manifest.name;
        break;
      }
    } catch (e) {
      // No package.json here (or unreadable) — keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) { break; }
    dir = parent;
  }

  packageNameCache.set(startDir, name);
  return name;
}

// Derive the package segment from the first stack frame outside this file.
// A logger must NEVER throw, so every failure path lands on FALLBACK_PACKAGE:
// stack formats vary by runtime (and vendored/bundled copies can lose paths),
// and a mislabelled log line is always cheaper than a crashed build.
function derivePackage() {
  try {
    const frames = (new Error().stack || '').split('\n').slice(1);
    for (const frame of frames) {
      const match = frame.match(/\((.*):\d+:\d+\)\s*$/) || frame.match(/at (.*):\d+:\d+\s*$/);
      if (!match) { continue; }
      const file = match[1].replace(/^file:\/\//, '');
      if (!path.isAbsolute(file)) { continue; }
      if (file === __filename) { continue; }
      return findPackageName(path.dirname(file)) || FALLBACK_PACKAGE;
    }
  } catch (e) {
    // Fall through to the fallback below.
  }
  return FALLBACK_PACKAGE;
}

// Logger class
function Logger(name) {
  const self = this;
  self.name = name;
  self.package = derivePackage();
}

// Make methods that log to console with the tag and time: [xx:xx:xx] [@omega.js/pkg:name] message
['log', 'error', 'warn', 'info'].forEach((method) => {
  Logger.prototype[method] = function () {
    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    let color;
    switch (method) {
      case 'warn':
        color = chalk.yellow;
        break;
      case 'error':
        color = chalk.red;
        break;
      default:
        color = (text) => text;
    }

    const args = [`[${chalk.magenta(time)}] [${chalk.cyan(`${this.package}:${this.name}`)}]`, ...Array.from(arguments).map((arg) => {
      if (typeof arg === 'string') {
        return color(arg);
      }
      if (arg instanceof Error) {
        return color(arg.stack);
      }
      return arg;
    })];

    console[method].apply(console, args);
  };
});

// Export chalk as format
Logger.prototype.format = chalk;

module.exports = Logger;
