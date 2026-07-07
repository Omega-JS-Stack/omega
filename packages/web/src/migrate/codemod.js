/**
 * codemod.js — walk a consumer's Liquid-bearing sources and apply the
 * migration rules (rules.js). One pass per file: rules run in order over the
 * full text; edits and findings accumulate per file for the report.
 *
 * Scope: `src/**` template files (.html, .md, .markdown, .liquid, .xml).
 * Assets (js/css/images), build output, and archive dirs are never touched.
 */
const fs = require('node:fs');
const path = require('node:path');
const { RULES } = require('./rules.js');

const TEMPLATE_EXTENSIONS = ['.html', '.md', '.markdown', '.liquid', '.xml'];
const SKIP_DIRS = ['assets', 'node_modules', 'dist', '_site', '_legacy', '_backup', '.git'];

/**
 * Collect the template files under a consumer's src/ dir.
 * @param {string} srcDir
 * @returns {string[]} absolute paths
 */
function collectTemplateFiles(srcDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.isFile() && TEMPLATE_EXTENSIONS.includes(path.extname(entry.name))) files.push(full);
    }
  };
  if (fs.existsSync(srcDir)) walk(srcDir);
  return files.sort();
}

/**
 * Run every rule over one file's text.
 * @param {string} text
 * @param {string} filePath - for reporting
 * @returns {{ text: string, edits: object[], findings: object[] }}
 */
function applyRules(text, filePath) {
  let current = text;
  const edits = [];
  const findings = [];
  for (const rule of RULES) {
    const result = rule.apply(current, { filePath });
    current = result.text;
    edits.push(...result.edits);
    findings.push(...result.findings.map((finding) => ({ ...finding, file: filePath })));
  }
  return { text: current, edits, findings };
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

  for (const filePath of collectTemplateFiles(srcDir)) {
    const original = fs.readFileSync(filePath, 'utf8');
    const { text, edits, findings: fileFindings } = applyRules(original, path.relative(root, filePath));
    findings.push(...fileFindings);
    if (edits.length === 0) continue;
    totalEdits += edits.length;
    results.push({ path: path.relative(root, filePath), edits });
    if (options.write && text !== original) fs.writeFileSync(filePath, text);
  }

  return { files: results, findings, totalEdits };
}

module.exports = { runCodemod, applyRules, collectTemplateFiles, TEMPLATE_EXTENSIONS };
