/**
 * `omega update` core — the ONE dependency-freshness implementation behind
 * every framework's update verb (npu-outdated semantics, Ian's node-power-user
 * tool): per dependency report installed vs wanted vs latest, classify the
 * jump (patch/minor/major), and QUARANTINE releases younger than --min-age
 * days (default 7 — a brand-new publish may be a compromised one; hold it
 * back unless explicitly forced). Report-only by default; --apply installs
 * the non-quarantined, non-breaking set (majors need the explicit --major
 * opt-in) through `npu install` when npu is on the machine, else plain
 * `npm install` with a loud note.
 *
 * `file:`/`link:`/git specs have no registry story (the local era's linked
 * @omega.js packages) — they're skipped with a dim note, never updated.
 *
 * Everything effectful is injectable (registry lookup, clock, exec) so the
 * test suite never touches the network; the live path is the thin defaults.
 */
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const REGISTRY_BASE = 'https://registry.npmjs.org';
const DEFAULT_MIN_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Specs with no registry story: local links, git, tarball URLs, and the
// bare `owner/repo` GitHub shorthand (never a valid version range).
const NON_REGISTRY_SPEC = /^(file:|link:|workspace:|portal:|git\+|git:|github:|https?:)/;

/**
 * Parse a semver-ish version string into comparable parts.
 * @param {string} value - e.g. '1.2.3', 'v1.2.3', '1.2.3-beta.1'
 * @returns {{ major: number, minor: number, patch: number, prerelease: string|null }|null}
 */
function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

/**
 * Compare two version strings (-1 / 0 / 1). A prerelease sorts BEFORE its
 * release triple; two prereleases compare lexically (enough for max-picking).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;

  for (const key of ['major', 'minor', 'patch']) {
    if (va[key] !== vb[key]) return va[key] < vb[key] ? -1 : 1;
  }
  if (va.prerelease === vb.prerelease) return 0;
  if (va.prerelease === null) return 1;
  if (vb.prerelease === null) return -1;
  return va.prerelease < vb.prerelease ? -1 : 1;
}

/**
 * Classify the jump between two versions.
 * @param {string} from
 * @param {string} to
 * @returns {'major'|'minor'|'patch'|null} null when equal/unparseable
 */
function classifyBump(from, to) {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (!a || !b || compareVersions(from, to) === 0) return null;
  if (a.major !== b.major) return 'major';
  if (a.minor !== b.minor) return 'minor';
  return 'patch';
}

/**
 * Whether a spec points at the npm registry at all.
 * @param {string} spec - package.json dependency value
 * @returns {boolean}
 */
function isRegistrySpec(spec) {
  const value = String(spec || '').trim();
  if (NON_REGISTRY_SPEC.test(value)) return false;
  // GitHub shorthand: owner/repo — a '/' never appears in a version range
  if (value.includes('/')) return false;
  return true;
}

/**
 * Extract the base version from a range spec ('^1.2.3' → '1.2.3').
 * @param {string} spec
 * @returns {string|null} null when the spec has no single base ('*', 'latest', '1.x')
 */
function cleanSpec(spec) {
  const match = String(spec || '').trim().match(/^[\^~=]?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  return match ? match[1] : null;
}

/**
 * Highest stable version satisfying a range spec — npm-outdated's "wanted".
 * Understands the specs this ecosystem actually writes: exact, ^, ~, >=,
 * x-ranges ('1.2.x', '1.x', '1'), and '*'/''/'latest'. Anything else → null.
 * @param {string} spec
 * @param {string[]} versions - all published versions
 * @returns {string|null}
 */
function resolveWanted(spec, versions) {
  const value = String(spec || '').trim();
  const stable = versions.filter((v) => {
    const parsed = parseVersion(v);
    return parsed && !parsed.prerelease;
  }).sort(compareVersions);
  const max = (list) => (list.length > 0 ? list[list.length - 1] : null);

  if (value === '*' || value === '' || value === 'latest') return max(stable);

  const base = cleanSpec(value);
  if (base) {
    const parsed = parseVersion(base);
    const atLeast = stable.filter((v) => compareVersions(v, base) >= 0);

    if (value.startsWith('^')) {
      // Caret: same major; 0.x pins the minor; 0.0.x pins the patch
      return max(atLeast.filter((v) => {
        const candidate = parseVersion(v);
        if (candidate.major !== parsed.major) return false;
        if (parsed.major === 0 && candidate.minor !== parsed.minor) return false;
        if (parsed.major === 0 && parsed.minor === 0 && candidate.patch !== parsed.patch) return false;
        return true;
      }));
    }
    if (value.startsWith('~')) {
      return max(atLeast.filter((v) => {
        const candidate = parseVersion(v);
        return candidate.major === parsed.major && candidate.minor === parsed.minor;
      }));
    }
    // Exact (with or without '=')
    return versions.includes(base) ? base : null;
  }

  if (value.startsWith('>=')) {
    const floor = cleanSpec(value.slice(2));
    return floor ? max(stable.filter((v) => compareVersions(v, floor) >= 0)) : null;
  }

  // x-ranges: '1', '1.x', '1.2', '1.2.x', '1.2.*' ('1.2.3' exact was handled above)
  const xMatch = value.match(/^(\d+)(?:\.(\d+|[x*]))?(?:\.[x*])?$/);
  if (xMatch) {
    const major = Number(xMatch[1]);
    const minor = xMatch[2] === undefined || /[x*]/.test(xMatch[2]) ? null : Number(xMatch[2]);
    return max(stable.filter((v) => {
      const candidate = parseVersion(v);
      return candidate.major === major && (minor === null || candidate.minor === minor);
    }));
  }

  return null;
}

/**
 * Highest stable version within a bump tier of `current` — npu's
 * patch/minor/latest targets.
 * @param {string[]} versions
 * @param {string} current
 * @param {'patch'|'minor'|'latest'} tier
 * @returns {string|null}
 */
function highestWithin(versions, current, tier) {
  const parsed = parseVersion(current);
  if (!parsed) return null;

  const candidates = versions.filter((v) => {
    const candidate = parseVersion(v);
    if (!candidate || candidate.prerelease) return false;
    if (compareVersions(v, current) < 0) return false;
    if (tier === 'patch') return candidate.major === parsed.major && candidate.minor === parsed.minor;
    if (tier === 'minor') return candidate.major === parsed.major;
    return true;
  }).sort(compareVersions);

  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

/**
 * Find a dependency's physically installed version — nearest node_modules
 * copy walking UP from dir (npm hoists to the brand root in brand monorepos).
 * @param {string} name - package name
 * @param {string} dir - starting directory
 * @returns {string|null}
 */
function findInstalledVersion(name, dir) {
  let current = path.resolve(dir);
  for (;;) {
    const manifest = path.join(current, 'node_modules', ...name.split('/'), 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        return JSON.parse(fs.readFileSync(manifest, 'utf8')).version || null;
      } catch (e) {
        return null;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Live registry lookup — full packument (the abbreviated form has no publish
 * times). The ONE network call of the verb; tests inject a fixture instead.
 * @param {string} name - package name
 * @param {object} [options]
 * @param {function} [options.fetchFn] - injectable fetch
 * @param {string} [options.registryUrl] - registry base URL
 * @returns {Promise<{ latest: string|null, versions: string[], time: object }>}
 */
async function fetchPackument(name, options = {}) {
  const fetchFn = options.fetchFn || fetch;
  const base = options.registryUrl || REGISTRY_BASE;
  const response = await fetchFn(`${base}/${name.replace('/', '%2F')}`, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) {
    // Zero publishes so far for @omega.js/* (HARD RULE 2) — a 404 is expected
    // in-monorepo, so say what it means instead of a bare status code
    throw new Error('not on the registry (unpublished?)');
  }
  if (!response.ok) {
    throw new Error(`registry ${response.status} for ${name}`);
  }
  const body = await response.json();
  return {
    latest: body['dist-tags']?.latest || null,
    versions: Object.keys(body.versions || {}),
    time: body.time || {},
  };
}

/**
 * Build the full update report for one target's package.json.
 * @param {object} options
 * @param {string} options.dir - target directory (package.json + node_modules climb)
 * @param {function} options.lookup - async (name) => { latest, versions, time }
 * @param {number} [options.now] - clock (ms epoch; injectable for tests)
 * @param {number} [options.minAge] - quarantine threshold in days (default 7; 0 disables)
 * @returns {Promise<{ project: string, rows: object[], locals: object[] }>}
 */
async function buildUpdateReport(options) {
  const dir = options.dir;
  const now = options.now ?? Date.now();
  const minAge = options.minAge ?? DEFAULT_MIN_AGE_DAYS;

  const manifestPath = path.join(dir, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No package.json in ${dir}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // `only` narrows the manifest to a named set — the brand-root shell rides
  // the fan-out for its @omega.js/manager pin alone (#794), and a brand's own
  // root tooling is none of that leg's business.
  const only = Array.isArray(options.only) ? new Set(options.only) : null;
  const pick = (deps) => (only ? Object.fromEntries(Object.entries(deps).filter(([name]) => only.has(name))) : deps);

  const groups = [
    ['prod', pick(manifest.dependencies || {})],
    ['dev', pick(manifest.devDependencies || {})],
  ];

  const locals = [];
  const rows = [];

  await Promise.all(groups.flatMap(([group, deps]) => Object.entries(deps).map(async ([name, spec]) => {
    if (!isRegistrySpec(spec)) {
      locals.push({ name, group, spec });
      return;
    }

    const installed = findInstalledVersion(name, dir);
    const current = cleanSpec(spec) || installed;

    const row = {
      name, group, spec, current, installed,
      wanted: null, latest: null, patchTarget: null, minorTarget: null,
      bump: null, publishedAt: null, ageDays: null, quarantined: false, error: null,
    };
    rows.push(row);

    let packument;
    try {
      packument = await options.lookup(name);
    } catch (e) {
      row.error = e.message;
      return;
    }

    row.wanted = resolveWanted(spec, packument.versions);
    row.latest = packument.latest
      || resolveWanted('*', packument.versions);
    if (current) {
      row.patchTarget = highestWithin(packument.versions, current, 'patch');
      row.minorTarget = highestWithin(packument.versions, current, 'minor');
      row.bump = row.latest ? classifyBump(current, row.latest) : null;
    }
    row.time = packument.time;

    // Quarantine display: how fresh is the latest release?
    const publishedAt = packument.time?.[row.latest];
    if (publishedAt) {
      row.publishedAt = new Date(publishedAt);
      row.ageDays = Math.floor((now - row.publishedAt.getTime()) / DAY_MS);
      row.quarantined = minAge > 0 && row.ageDays < minAge && installed !== row.latest;
    }
  })));

  // Only rows needing attention, prod before dev, alpha within group
  const rank = { prod: 0, dev: 1 };
  const attention = rows
    .filter((row) => row.error || (row.latest && row.latest !== row.current) || (row.installed && row.current && row.installed !== row.current))
    .sort((a, b) => (rank[a.group] - rank[b.group]) || a.name.localeCompare(b.name));

  locals.sort((a, b) => a.name.localeCompare(b.name));

  return { project: manifest.name || path.basename(dir), rows: attention, locals };
}

/**
 * Pick the updates an --apply run installs. Default tier is MINOR (highest
 * same-major — npu's non-breaking lane); --major unlocks latest. A target
 * published < minAge days ago is HELD (quarantine) unless already installed.
 * @param {object[]} rows - buildUpdateReport rows
 * @param {object} [options]
 * @param {boolean} [options.major] - allow breaking jumps to latest
 * @param {number} [options.minAge] - quarantine threshold in days (0 disables)
 * @param {number} [options.now] - clock (injectable)
 * @returns {{ updates: object[], quarantined: object[], majorsHeld: object[] }}
 */
function selectUpdates(rows, options = {}) {
  const minAge = options.minAge ?? DEFAULT_MIN_AGE_DAYS;
  const now = options.now ?? Date.now();

  const updates = [];
  const quarantined = [];
  const majorsHeld = [];

  for (const row of rows) {
    if (row.error || !row.current) continue;

    const target = options.major ? row.latest : row.minorTarget;
    if (!target || compareVersions(target, row.current) <= 0) {
      // Nothing applicable in-tier; note the held major so the human sees it
      if (!options.major && row.bump === 'major' && row.latest !== row.installed) {
        majorsHeld.push({ name: row.name, from: row.current, to: row.latest });
      }
      continue;
    }

    // Quarantine the TARGET version by its own publish age
    const publishedAt = row.time?.[target];
    const ageDays = publishedAt ? Math.floor((now - new Date(publishedAt).getTime()) / DAY_MS) : null;
    if (minAge > 0 && ageDays !== null && ageDays < minAge && row.installed !== target) {
      quarantined.push({ name: row.name, from: row.current, to: target, ageDays });
      continue;
    }

    updates.push({ name: row.name, group: row.group, from: row.current, to: target, bump: classifyBump(row.current, target) });

    if (!options.major && row.bump === 'major' && row.latest !== target) {
      majorsHeld.push({ name: row.name, from: row.current, to: row.latest });
    }
  }

  return { updates, quarantined, majorsHeld };
}

/**
 * Whether npu (node-power-user — the Socket-firewalled npm wrapper) exists
 * on this machine.
 * @param {object} [options]
 * @param {function} [options.execFn] - injectable exec
 * @returns {boolean}
 */
function detectNpu(options = {}) {
  const execFn = options.execFn || ((cmd, opts) => execSync(cmd, opts));
  try {
    execFn('npu --version', { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Build the install command(s) for a selected update set — one per dep group
 * (npm relocates a dev dep to dependencies without --save-dev). Installs run
 * through `npu install` when npu exists (Socket supply-chain firewall);
 * otherwise plain `npm install` (the caller warns loudly).
 *
 * The @omega.js family rides its own command per group, with `--save-exact`
 * (#794): npm's default save-prefix writes `^<version>`, so the one verb that
 * is ALLOWED to move a brand would have un-pinned the family it just moved.
 * Everything else keeps npm's default prefix — the pin is the family's rule,
 * not a rule for the whole dependency tree.
 * @param {object[]} updates - selectUpdates().updates
 * @param {object} options
 * @param {boolean} options.hasNpu
 * @returns {Array<{ command: string, group: string }>}
 */
function buildInstallCommands(updates, options) {
  const bin = options.hasNpu ? 'npu install' : 'npm install';
  const commands = [];

  for (const [group, flag] of [['prod', ''], ['dev', ' --save-dev']]) {
    const inGroup = updates.filter((update) => update.group === group);

    for (const [family, extra] of [[false, ''], [true, ' --save-exact']]) {
      const specs = inGroup
        .filter((update) => update.name.startsWith('@omega.js/') === family)
        .map((update) => `${update.name}@${update.to}`);
      if (specs.length > 0) {
        commands.push({ command: `${bin} ${specs.join(' ')}${flag}${extra}`, group });
      }
    }
  }

  return commands;
}

/**
 * Render the report as plain padded-table lines (framework wrappers print
 * them through their own logger; no color dependency in the shared core).
 * @param {{ project: string, rows: object[], locals: object[] }} report
 * @param {object} [options]
 * @param {number} [options.minAge]
 * @returns {string[]}
 */
function formatReport(report, options = {}) {
  const minAge = options.minAge ?? DEFAULT_MIN_AGE_DAYS;
  const lines = [];

  if (report.rows.length === 0) {
    lines.push('All registry dependencies are up to date.');
  } else {
    const header = ['Package', 'Group', 'Current', 'Installed', 'Wanted', 'Latest', 'Bump', 'Released', 'Status'];
    const body = report.rows.map((row) => {
      const released = row.publishedAt
        ? `${row.publishedAt.toISOString().split('T')[0]} (${row.ageDays}d)`
        : '-';
      const status = row.error ? `lookup failed: ${row.error}`
        : row.quarantined ? 'QUARANTINED'
        : '';
      return [
        row.name, row.group, row.current || '-', row.installed || '-',
        row.wanted || '-', row.latest || '-', row.bump || '-', released, status,
      ];
    });

    const widths = header.map((cell, index) => Math.max(cell.length, ...body.map((cells) => String(cells[index]).length)));
    const render = (cells) => cells.map((cell, index) => String(cell).padEnd(widths[index])).join('  ').trimEnd();
    lines.push(render(header));
    lines.push(widths.map((width) => '-'.repeat(width)).join('  '));
    for (const cells of body) lines.push(render(cells));

    if (report.rows.some((row) => row.quarantined)) {
      lines.push(`QUARANTINED = latest published < ${minAge} days ago (held from --apply; --min-age 0 or --force-fresh overrides)`);
    }
    if (report.rows.some((row) => row.bump === 'major')) {
      lines.push('major = breaking — never auto-applied (explicit --major opt-in)');
    }
  }

  for (const local of report.locals) {
    lines.push(`skipped ${local.name} (${local.spec}) — local spec, no registry story`);
  }

  return lines;
}

/**
 * The one verb body every wrapper calls: report (default), then apply when
 * asked. Flags mirror npu: --apply, --major, --min-age N (default 7, 0
 * disables), --force-fresh (alias for --min-age 0).
 * @param {object} [options]
 * @param {string} [options.dir] - target directory (default cwd)
 * @param {string[]} [options.only] - check just these package names (#794)
 * @param {boolean} [options.apply] - install the selected set
 * @param {boolean} [options.major] - allow breaking jumps (with --apply)
 * @param {number} [options.minAge] - quarantine threshold in days
 * @param {boolean} [options.forceFresh] - disable the age quarantine
 * @param {object} [options.logger] - logger with log/warn (default console)
 * @param {function} [options.lookup] - injectable registry lookup (tests)
 * @param {function} [options.execFn] - injectable exec (tests)
 * @param {number} [options.now] - injectable clock (tests)
 * @param {boolean} [options.hasNpu] - injectable npu detection (tests)
 * @returns {Promise<{ report: object, selection: object|null, commands: object[] }>}
 */
async function runUpdate(options = {}) {
  const dir = options.dir || process.cwd();
  const logger = options.logger || console;
  const now = options.now ?? Date.now();
  const minAge = options.forceFresh ? 0 : Number(options.minAge ?? DEFAULT_MIN_AGE_DAYS);
  const lookup = options.lookup || ((name) => fetchPackument(name));

  const report = await buildUpdateReport({ dir, lookup, now, minAge, only: options.only });
  logger.log(`Dependency report for ${report.project}:`);
  for (const line of formatReport(report, { minAge })) logger.log(line);

  if (!options.apply) {
    if (report.rows.length > 0) {
      logger.log('Report only — `omega update --apply` installs the non-quarantined, non-breaking set (--major for breaking).');
    }
    return { report, selection: null, commands: [] };
  }

  const selection = selectUpdates(report.rows, { major: options.major, minAge, now });

  for (const held of selection.quarantined) {
    logger.warn(`held ${held.name}@${held.to} — published ${held.ageDays}d ago (< ${minAge}d quarantine)`);
  }
  for (const held of selection.majorsHeld) {
    logger.warn(`held ${held.name} ${held.from} → ${held.to} — major (breaking); re-run with --major to include`);
  }

  if (selection.updates.length === 0) {
    logger.log('Nothing to apply.');
    return { report, selection, commands: [] };
  }

  const hasNpu = options.hasNpu ?? detectNpu({ execFn: options.execFn });
  if (!hasNpu) {
    logger.warn('npu (node-power-user) is NOT on this machine — installing via plain `npm install`, WITHOUT the Socket supply-chain firewall.');
  }

  const commands = buildInstallCommands(selection.updates, { hasNpu });
  const execFn = options.execFn || ((cmd, opts) => execSync(cmd, opts));
  for (const entry of commands) {
    logger.log(`Running: ${entry.command}`);
    execFn(entry.command, { cwd: dir, stdio: 'inherit' });
  }

  logger.log(`Applied ${selection.updates.length} update(s).`);
  return { report, selection, commands };
}

module.exports = {
  DEFAULT_MIN_AGE_DAYS,
  parseVersion,
  compareVersions,
  classifyBump,
  isRegistrySpec,
  cleanSpec,
  resolveWanted,
  highestWithin,
  findInstalledVersion,
  fetchPackument,
  buildUpdateReport,
  selectUpdates,
  detectNpu,
  buildInstallCommands,
  formatReport,
  runUpdate,
};
