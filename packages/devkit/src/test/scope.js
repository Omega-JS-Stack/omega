/**
 * Test-scope grammar (C5) — ONE parser for `omega test` targets across every
 * framework, so scoping means the same thing in a web app, a backend, a
 * desktop app, and an extension:
 *
 *   npx omega test                     → PROJECT tests only (consumer context)
 *   npx omega test pages/              → project tests under pages/
 *   npx omega test project:pages/      → same, explicit (`brand:` = alias)
 *   npx omega test framework:          → the framework's own suite
 *   npx omega test framework:routes/   → framework suite, scoped
 *   npx omega test full:               → both sources
 *   npx omega test full:auth           → both sources, path-scoped
 *
 * `omega:` and `mgr:` are universal framework aliases; each framework also
 * answers to its own ids (e.g. `backend:`, `em:`, `extension:`, `web:`) via
 * `frameworkAliases`. Bare paths bind to the PROJECT source — reaching the
 * framework suite is always an explicit choice (Ian 2026-07-11: bare runs
 * from a brand must never drag the framework corpus in).
 *
 * Framework SELF context (running inside the framework package itself —
 * `selfTest: true`) flips the no-target default to the framework suite, so
 * each package's own `npm test` keeps meaning "run my suite".
 */

const UNIVERSAL_FRAMEWORK_ALIASES = ['framework', 'omega', 'mgr'];
const PROJECT_ALIASES = ['project', 'brand'];
const FULL_ALIASES = ['full'];

/**
 * Parse `omega test` positional targets into sources + per-source path filters.
 *
 * @param {string[]} rawTargets - Positional targets (may be empty)
 * @param {Object} [options]
 * @param {string[]} [options.frameworkAliases] - Extra framework prefixes for
 *   this framework (e.g. ['backend'], ['em'], ['extension'], ['web'])
 * @param {boolean} [options.selfTest] - True when running inside the framework
 *   package itself (no consumer project)
 * @returns {{
 *   sources: string[],                             // subset of ['framework', 'project']
 *   filters: { framework: string[], project: string[] }, // prefix-stripped path filters per source
 *   invalid: string[],                             // unrecognized `<word>:` prefixes (likely typos)
 * }}
 */
function parseTestScope(rawTargets, options = {}) {
  const frameworkAliases = new Set([
    ...UNIVERSAL_FRAMEWORK_ALIASES,
    ...(options.frameworkAliases || []),
  ]);

  const sources = new Set();
  const filters = { framework: [], project: [] };
  const invalid = [];

  for (const raw of rawTargets || []) {
    const target = String(raw).trim();
    if (!target) continue;

    const match = target.match(/^([a-z-]+):(.*)$/);

    if (!match) {
      // Bare path — binds to the PROJECT source.
      sources.add('project');
      filters.project.push(target);
      continue;
    }

    const [, prefix, pathPart] = match;

    if (frameworkAliases.has(prefix)) {
      sources.add('framework');
      if (pathPart) filters.framework.push(pathPart);
    } else if (PROJECT_ALIASES.includes(prefix)) {
      sources.add('project');
      if (pathPart) filters.project.push(pathPart);
    } else if (FULL_ALIASES.includes(prefix)) {
      sources.add('framework');
      sources.add('project');
      if (pathPart) {
        filters.framework.push(pathPart);
        filters.project.push(pathPart);
      }
    } else {
      // Unknown prefix — surface it rather than silently matching nothing.
      invalid.push(target);
    }
  }

  // No targets (or only invalid ones): consumer default = project only;
  // framework self context = the framework's own suite.
  if (sources.size === 0) {
    sources.add(options.selfTest ? 'framework' : 'project');
  }

  return {
    sources: ['framework', 'project'].filter((s) => sources.has(s)),
    filters,
    invalid,
  };
}

module.exports = { parseTestScope, UNIVERSAL_FRAMEWORK_ALIASES, PROJECT_ALIASES };
