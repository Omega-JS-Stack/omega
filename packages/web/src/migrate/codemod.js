/**
 * codemod.js — walk a consumer's Liquid-bearing sources and apply the
 * migration rules (rules.js). One pass per file: rules run in order over the
 * full text; edits and findings accumulate per file for the report.
 *
 * THREE walks, because the rule tables answer to different file shapes:
 * - templates: `src/**` (.html, .md, .markdown, .liquid, .xml), assets skipped
 * - scripts:   `src/**` .js — the consumer asset layer (src/assets/js) plus the
 *   service-worker entry at the src root, carrying the client-runtime imports
 *   (#248). Template rules never run here (`page.title` in a script is an
 *   object property, not a frontmatter read).
 * - descriptors: EVERY `src/**` .json (assets included) — section descriptors
 *   (`_includes/**\/sections/*.json`) are the motivating case: they declare
 *   the client bindings and the signout class as DATA. Only the exact-token
 *   markup rule runs (JSON_RULES): skipping them left a HALF-rename — the
 *   JS selectors renamed, the descriptor that emits the class not (#248).
 *
 * The asset layer's OTHER concerns — the seed main.js deletion, the scss
 * package reference — stay in consumer-assets.js; this walk only rewrites text.
 * Build output and archive dirs are never touched by either walk.
 */
const fs = require('node:fs');
const path = require('node:path');
const { RULES, JS_RULES, JSON_RULES } = require('./rules.js');

const TEMPLATE_EXTENSIONS = ['.html', '.md', '.markdown', '.liquid', '.xml'];
const SCRIPT_EXTENSIONS = ['.js'];
const JSON_EXTENSIONS = ['.json'];
const SKIP_DIRS = ['assets', 'node_modules', 'dist', '_site', '_legacy', '_backup', '.git'];
// The script walk keeps `assets` — that IS the consumer's JS
const SCRIPT_SKIP_DIRS = SKIP_DIRS.filter((dir) => dir !== 'assets');

/**
 * Collect the files under a dir with the given extensions, skipping the named
 * directories.
 * @param {string} dir
 * @param {string[]} extensions
 * @param {string[]} skipDirs
 * @returns {string[]} absolute paths
 */
function collectFiles(dir, extensions, skipDirs) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.isFile() && extensions.includes(path.extname(entry.name))) files.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return files.sort();
}

/**
 * Collect the template files under a consumer's src/ dir.
 * @param {string} srcDir
 * @returns {string[]} absolute paths
 */
function collectTemplateFiles(srcDir) {
  return collectFiles(srcDir, TEMPLATE_EXTENSIONS, SKIP_DIRS);
}

/**
 * Collect the consumer JS files under a consumer's src/ dir.
 * @param {string} srcDir
 * @returns {string[]} absolute paths
 */
function collectScriptFiles(srcDir) {
  return collectFiles(srcDir, SCRIPT_EXTENSIONS, SCRIPT_SKIP_DIRS);
}

/**
 * Collect the JSON descriptors under a consumer's src/ dir.
 * @param {string} srcDir
 * @returns {string[]} absolute paths
 */
function collectJsonFiles(srcDir) {
  return collectFiles(srcDir, JSON_EXTENSIONS, SCRIPT_SKIP_DIRS);
}

/**
 * Run one rule table over a file's text.
 * @param {object[]} rules
 * @param {string} text
 * @param {string} filePath - for reporting
 * @returns {{ text: string, edits: object[], findings: object[] }}
 */
function applyRuleTable(rules, text, filePath) {
  let current = text;
  const edits = [];
  const findings = [];
  for (const rule of rules) {
    const result = rule.apply(current, { filePath });
    current = result.text;
    edits.push(...result.edits);
    findings.push(...result.findings.map((finding) => ({ ...finding, file: filePath })));
  }
  return { text: current, edits, findings };
}

/**
 * Run every TEMPLATE rule over one file's text.
 * @param {string} text
 * @param {string} filePath - for reporting
 * @returns {{ text: string, edits: object[], findings: object[] }}
 */
function applyRules(text, filePath) {
  return applyRuleTable(RULES, text, filePath);
}

/**
 * Run every consumer-JS rule over one file's text.
 * @param {string} text
 * @param {string} filePath - for reporting
 * @returns {{ text: string, edits: object[], findings: object[] }}
 */
function applyJsRules(text, filePath) {
  return applyRuleTable(JS_RULES, text, filePath);
}

/**
 * Run every JSON-descriptor rule over one file's text.
 * @param {string} text
 * @param {string} filePath - for reporting
 * @returns {{ text: string, edits: object[], findings: object[] }}
 */
function applyJsonRules(text, filePath) {
  return applyRuleTable(JSON_RULES, text, filePath);
}

/**
 * Apply the codemod across a consumer's src/ tree.
 * @param {string} root - consumer project root
 * @param {object} [options]
 * @param {boolean} [options.write] - write changed files (false = report only)
 * @returns {{ files: object[], findings: object[], totalEdits: number }}
 */
function runCodemod(root, options = {}) {
  const srcDir = path.join(root, 'src');
  const results = [];
  const findings = [];
  let totalEdits = 0;

  const passes = [
    [collectTemplateFiles(srcDir), applyRules],
    [collectScriptFiles(srcDir), applyJsRules],
    [collectJsonFiles(srcDir), applyJsonRules],
  ];

  for (const [filePaths, apply] of passes) {
    for (const filePath of filePaths) {
      const original = fs.readFileSync(filePath, 'utf8');
      const { text, edits, findings: fileFindings } = apply(original, path.relative(root, filePath));
      findings.push(...fileFindings);
      if (edits.length === 0) continue;
      totalEdits += edits.length;
      results.push({ path: path.relative(root, filePath), edits });
      if (options.write && text !== original) fs.writeFileSync(filePath, text);
    }
  }

  return { files: results, findings, totalEdits };
}

module.exports = { runCodemod, applyRules, applyJsRules, applyJsonRules, collectTemplateFiles, TEMPLATE_EXTENSIONS };
