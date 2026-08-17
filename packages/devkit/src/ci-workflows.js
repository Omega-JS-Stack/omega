/**
 * Brand-monorepo CI composition (#265).
 *
 * Every framework scaffolds `.github/workflows/*.yml` into the app it sets up.
 * That is correct for a STANDALONE app (the app dir is the git root) and dead on
 * arrival inside a brand monorepo: GitHub executes workflows from the REPO
 * ROOT's `.github/workflows/` only, so `apps/extension/.github/workflows/publish.yml`
 * never runs — CI builds and store publishes silently do not exist.
 *
 * In a monorepo the app's workflow is COMPOSED into the root dir instead: one
 * file per app (`<app>-<workflow>.yml`), every post-checkout `run:` step scoped
 * to the app's path, regenerated from the framework template on every setup — so
 * a re-run updates the app's own file and can never duplicate a job. Each app's
 * runs also get their own concurrency group, so one app's deploy never cancels
 * another's.
 *
 * Scoping is by working directory, not by a `paths:` trigger filter: OMEGA
 * workflows carry NO push triggers by design (deliberate deploys — D13), and a
 * path filter on a dispatch-only workflow filters nothing. It is declared PER
 * STEP, not as a workflow-level `defaults.run.working-directory`: that would
 * also scope the steps that run before actions/checkout (and the jobs that never
 * check out), where the app dir does not exist yet.
 */
const path = require('path');
const jetpack = require('fs-jetpack');

/**
 * Action inputs that name a path inside the checkout, per action. `uses:` steps
 * ignore `working-directory:` entirely (it is a `run:` key), so a composed
 * workflow has to scope these itself — the gh-pages publish otherwise pushes a
 * repo-root `dist/` no build ever wrote, and the cache key hashes nothing.
 *
 * Named per action on purpose: a blanket "any input called path" rule would
 * rewrite inputs that mean something else — `actions/checkout`'s `path:` names
 * where to CLONE the repo, not a file in it. An action missing from this table
 * is left alone; add it here when a template starts using it.
 */
const SCOPED_ACTION_INPUTS = {
  'actions/cache': ['path'],
  'actions/upload-artifact': ['path'],
  'actions/download-artifact': ['path'],
  'peaceiris/actions-gh-pages': ['publish_dir'],
};

/**
 * Compose one framework workflow template for an app inside a brand monorepo.
 * Pure: text in, text out.
 * @param {string} contents - The (already rendered) workflow template
 * @param {object} options
 * @param {string} options.appPath - The app's path relative to the repo root (e.g. apps/extension)
 * @param {string} options.appName - The app's short name (e.g. extension)
 * @returns {string} the composed workflow
 */
function composeWorkflow(contents, options) {
  const appPath = options.appPath;
  const appName = options.appName;

  let composed = contents;

  // Display name carries the app — two apps' runs are told apart in the
  // Actions list, where only the workflow name shows.
  composed = composed.replace(/^name:[ \t]*(.*)$/m, (full, value) => `name: ${value.trim()} (${appPath})`);

  // Per-app concurrency: `${{ github.ref }}` alone means the website's deploy
  // cancels the extension's.
  composed = composed.replace(/^(concurrency:\n(?:[ \t]+.*\n)*?[ \t]+group:[ \t]*)(.*)$/m, (full, prefix, value) => `${prefix}${appName}-${value.trim()}`);

  // Every `run:` step that follows its job's checkout executes in the app dir
  // (`uses:` actions — checkout and friends — stay at the repo root, which is
  // what they want).
  composed = scopeRunSteps(composed, appPath);

  return `${header(appPath)}${composed}`;
}

/**
 * Compose every workflow a framework ships for one app into the brand root's
 * `.github/workflows/`, and sweep the app's own dead copy.
 * @param {object} options
 * @param {string} options.sourceDir - The framework's `.github/workflows` defaults dir
 * @param {string} options.appDir - The consumer app dir
 * @param {string} options.brandRoot - The brand (repo) root
 * @param {Function} [options.transform] - `(contents, name) => contents`, run before composing
 * @param {object} [options.logger] - Logger with `log`/`warn` (defaults to console)
 * @returns {{ written: string[], skipped: string[], removed: string[] }} brand-root-relative paths
 */
function composeAppWorkflows(options) {
  const { sourceDir, appDir, brandRoot } = options;
  const transform = options.transform || null;
  const logger = options.logger || console;
  const result = { written: [], skipped: [], removed: [] };

  if (!jetpack.exists(sourceDir)) {
    return result;
  }

  const appPath = relativePath(brandRoot, appDir);
  const appName = path.basename(appDir);

  for (const name of jetpack.list(sourceDir).sort()) {
    const source = path.join(sourceDir, name);
    if (jetpack.exists(source) !== 'file') {
      continue;
    }

    let rendered = jetpack.read(source);
    if (transform) {
      rendered = transform(rendered, name);
    }

    const composed = composeWorkflow(rendered, { appPath, appName });
    const relative = `.github/workflows/${appName}-${name}`;
    const destination = path.join(brandRoot, '.github', 'workflows', `${appName}-${name}`);

    if (jetpack.exists(destination) && jetpack.read(destination) === composed) {
      result.skipped.push(relative);
    } else {
      jetpack.write(destination, composed);
      result.written.push(relative);
      logger.log(`Composed → ${relative} (runs ${appPath} from the repo root)`);
    }

    // The app's own copy is dead weight in a monorepo: delete the untouched
    // framework file, report a differing one rather than destroying it.
    sweepAppCopy({ appDir, appPath, name, composedName: relative, rendered, logger, result });
  }

  return result;
}

/**
 * The workflow file name to dispatch for an app — composed in a brand monorepo,
 * the framework's own name standalone. The ONE place deploy verbs and the
 * compose step agree on the name.
 * @param {object} options
 * @param {string} options.appDir - The consumer app dir
 * @param {string|null} options.brandRoot - The brand root, or null when standalone
 * @param {string} options.workflow - The framework's workflow file name (e.g. publish.yml)
 * @returns {string} the workflow file name
 */
function composedWorkflowName(options) {
  if (!options.brandRoot || path.resolve(options.brandRoot) === path.resolve(options.appDir)) {
    return options.workflow;
  }
  return `${path.basename(options.appDir)}-${options.workflow}`;
}

// Scope every `run:` step that executes AFTER its job's checkout to the app dir.
// A workflow-level `defaults.run.working-directory` reads cleaner but applies to
// EVERY run step, including the ones that execute before actions/checkout (the
// git config step, a matrix-resolving step) and the jobs that never check out at
// all — the app dir does not exist there yet, and the job dies on step 1.
function scopeRunSteps(contents, appPath) {
  const lines = contents.split('\n');
  const output = [];
  let insideJobs = false;
  let stepsIndent = -1; // indent of the open `steps:` key, -1 when outside one
  let itemIndent = -1;  // indent of that list's `- ` step items
  let checkedOut = false; // has THIS job checked out yet
  let step = null;      // the buffered lines of the step being read

  const flush = () => {
    if (!step) return;
    output.push(...(checkedOut ? scopeStep(step, itemIndent + 2, appPath) : step));
    checkedOut = checkedOut || step.some((line) => /^[ \t]*(?:- )?uses:[ \t]*actions\/checkout/.test(line));
    step = null;
  };

  for (const line of lines) {
    const indent = line.search(/\S/);
    // Comments and blank lines never close a block — they belong to what follows
    const structural = indent >= 0 && !line.trimStart().startsWith('#');

    // A top-level key closes any open steps list and says whether we are in `jobs:`
    if (structural && indent === 0) {
      flush();
      stepsIndent = -1;
      insideJobs = /^jobs:[ \t]*$/.test(line);
      output.push(line);
      continue;
    }

    // The steps list ends where the job's next key begins
    if (stepsIndent >= 0 && structural && indent <= stepsIndent) {
      flush();
      stepsIndent = -1;
    }

    if (stepsIndent >= 0) {
      const item = structural && /^[ \t]*- /.test(line);
      if (item && itemIndent === -1) {
        itemIndent = indent;
      }

      if (item && indent === itemIndent) {
        flush();
        step = [line];
        continue;
      }

      if (step) {
        step.push(line);
        continue;
      }
    } else if (insideJobs) {
      const opens = /^([ \t]+)steps:[ \t]*$/.exec(line);
      if (opens) {
        stepsIndent = opens[1].length;
        itemIndent = -1;
        checkedOut = false;
      }
    }

    output.push(line);
  }

  flush();

  return output.join('\n');
}

// Scope one post-checkout step to the app: a `run:` step gets a
// `working-directory:`, a `uses:` step gets its path-bearing inputs rewritten
// (the key is illegal there), and every step's `hashFiles()` patterns are moved
// into the app dir.
function scopeStep(step, keyIndent, appPath) {
  const lines = scopeHashFiles(step, appPath);
  const action = actionOf(lines, keyIndent);

  if (action) {
    return scopeActionInputs(lines, keyIndent, appPath, SCOPED_ACTION_INPUTS[action]);
  }

  return scopeRunStep(lines, keyIndent, appPath);
}

// The action a `uses:` step runs, version stripped (`actions/cache@v4` → `actions/cache`).
function actionOf(step, keyIndent) {
  const pad = ' '.repeat(keyIndent);
  const line = step.find((entry, index) => (index === 0 ? /^[ \t]*- uses:/.test(entry) : entry.startsWith(`${pad}uses:`)));

  return line ? line.slice(line.indexOf('uses:') + 5).trim().split('@')[0] : null;
}

// `hashFiles()` globs from GITHUB_WORKSPACE wherever it appears — no step key
// moves it — so a composed app workflow's patterns carry the app path or match
// nothing at all.
function scopeHashFiles(step, appPath) {
  return step.map((line) => line.replace(/hashFiles\(([^)]*)\)/g, (full, args) => {
    const scoped = args.replace(/(['"])([^'"]+)\1/g, (quoted, quote, pattern) => `${quote}${joinAppPath(pattern, appPath)}${quote}`);
    return `hashFiles(${scoped})`;
  }));
}

// Rewrite the named inputs of a `uses:` step's `with:` block to app-relative
// paths. A `|` block scalar (upload-artifact's multi-glob `path:`) is rewritten
// line by line.
function scopeActionInputs(step, keyIndent, appPath, inputs) {
  if (!inputs) {
    return step;
  }

  const pad = ' '.repeat(keyIndent);
  const withIndex = step.findIndex((line) => line.startsWith(`${pad}with:`));
  if (withIndex === -1) {
    return step;
  }

  const scoped = [...step];
  let blockIndent = -1;

  for (let index = withIndex + 1; index < scoped.length; index++) {
    const line = scoped[index];
    const indent = line.search(/\S/);

    if (indent === -1) {
      continue;
    }

    if (blockIndent >= 0 && indent > blockIndent) {
      scoped[index] = line.slice(0, indent) + joinAppPath(line.slice(indent), appPath);
      continue;
    }

    blockIndent = -1;

    // Back out at the step's own key level: the `with:` block is over
    if (indent <= keyIndent) {
      break;
    }

    const entry = /^([ \t]+)([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!entry || !inputs.includes(entry[2])) {
      continue;
    }

    if (/^[|>]/.test(entry[3])) {
      blockIndent = entry[1].length;
      continue;
    }

    scoped[index] = `${entry[1]}${entry[2]}: ${scopeValue(entry[3], appPath)}`;
  }

  return scoped;
}

// Prefix a YAML scalar's path with the app path, quotes preserved.
function scopeValue(value, appPath) {
  const quoted = /^(['"])(.*)\1$/.exec(value.trim());
  if (!quoted) {
    return joinAppPath(value.trim(), appPath);
  }

  return `${quoted[1]}${joinAppPath(quoted[2], appPath)}${quoted[1]}`;
}

// An app-relative path/glob. Absolute paths and expression-built values name
// something other than a file in the checkout — those are left as written.
function joinAppPath(value, appPath) {
  const trimmed = value.trim();
  const scoped = trimmed.replace(/^\.\//, '');

  if (!trimmed || trimmed.startsWith('/') || trimmed.startsWith('~') || trimmed.includes('${{') || scoped === appPath || scoped.startsWith(`${appPath}/`)) {
    return trimmed;
  }

  return `${appPath}/${scoped}`;
}

// Declare `working-directory` on one run step's lines — a step that already
// declares its own is left alone.
function scopeRunStep(step, keyIndent, appPath) {
  const pad = ' '.repeat(keyIndent);
  const declared = `working-directory: ${appPath}`;
  const alreadyScoped = /^[ \t]*- working-directory:/.test(step[0]) || step.some((line) => line.startsWith(`${pad}working-directory:`));

  if (alreadyScoped) {
    return step;
  }

  const runIndex = step.findIndex((line, index) => (index === 0 ? /^[ \t]*- run:/.test(line) : line.startsWith(`${pad}run:`)));
  if (runIndex === -1) {
    return step;
  }

  // A `- run: …` step carries its command on the dash line: working-directory
  // takes the dash and `run:` moves to its own key line (a `|` block scalar's
  // body is indented deeper, so it rides along untouched).
  if (runIndex === 0) {
    const dash = step[0].slice(0, step[0].indexOf('- ') + 2);
    return [`${dash}${declared}`, `${pad}${step[0].slice(dash.length)}`, ...step.slice(1)];
  }

  return [...step.slice(0, runIndex), `${pad}${declared}`, ...step.slice(runIndex)];
}

// Delete the app-level copy of a workflow when the framework wrote every line
// of it (framework-owned); keep and report one carrying anything else.
function sweepAppCopy(context) {
  const { appDir, appPath, name, composedName, rendered, logger, result } = context;
  const appCopy = path.join(appDir, '.github', 'workflows', name);

  if (jetpack.exists(appCopy) !== 'file') {
    return;
  }

  if (isFrameworkGeneration(jetpack.read(appCopy), rendered)) {
    jetpack.remove(appCopy);
    pruneEmptyDirs(path.dirname(appCopy), appDir);
    result.removed.push(`.github/workflows/${name}`);
    logger.log(`Removed ${appPath}/.github/workflows/${name} — GitHub only runs workflows from the repo root`);
    return;
  }

  logger.warn(`Kept ${appPath}/.github/workflows/${name} — it differs from the current framework template (your edits, or an older framework version), and GitHub NEVER runs a workflow from an app dir. Compare it against ${composedName}, move anything it still needs, then delete ${appPath}/.github/workflows/${name}`);
}

// Is every line of the app's copy a line the current template still ships, in
// the template's own order? Then the framework wrote all of it and the copy is
// safe to delete. An exact match is the trivial case, and a copy a SUPERSEDED
// template wrote passes too, because templates evolve by GAINING lines (#189
// added the generated secrets block; every copy scaffolded before it is that
// same file minus those lines, #334). A line the consumer ADDED or CHANGED is a
// line no template of this framework ever shipped, so it fails here and the
// copy is kept. Accepted blind spot: an edit that ONLY deletes lines is still a
// subsequence and gets swept — bounded, because an app-dir workflow never runs
// and the composed root file is regenerated from the current template.
function isFrameworkGeneration(existing, rendered) {
  const template = rendered.split('\n');
  let cursor = 0;

  for (const line of existing.split('\n')) {
    cursor = template.indexOf(line, cursor);
    if (cursor === -1) {
      return false;
    }
    cursor++;
  }

  return true;
}

// Remove now-empty ancestor dirs of a swept file, stopping at (never removing) rootDir.
function pruneEmptyDirs(dir, rootDir) {
  const root = path.resolve(rootDir);
  let current = path.resolve(dir);
  while (current !== root && current.startsWith(root + path.sep)) {
    if ((jetpack.list(current) || []).length > 0) return;
    jetpack.remove(current);
    current = path.dirname(current);
  }
}

// posix-style app path — this string ends up inside a YAML workflow.
function relativePath(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function header(appPath) {
  return [
    `# GENERATED by \`omega setup\` for ${appPath} — do not edit.`,
    '# GitHub runs workflows from the repo root only, so this brand\'s per-app CI',
    `# lives here and every step after the checkout runs in ${appPath}. Change the`,
    '# app\'s config (or the framework template) and re-run setup; this file is',
    '# rewritten from scratch.',
    '',
  ].join('\n');
}

module.exports = { composeWorkflow, composeAppWorkflows, composedWorkflowName };
