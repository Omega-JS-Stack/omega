/**
 * workflow-headers tests: the four CI workflow templates a framework writes
 * into a consumer target read as one family. Each template's leading comment
 * header and its version step are compared with the backend's, the canonical
 * template; neither carries a scaffold token, so each reads as it renders.
 *
 * Run: node --test scripts/workflow-headers.test.js
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const defineCases = require('@omega.js/devkit/test/define-cases');

const PACKAGES_DIR = path.join(__dirname, '..', 'packages');

// The backend's template is the canonical one; the other three match it.
const TEMPLATES = [
  { framework: 'backend', file: 'backend/src/defaults/.github/workflows/deploy.yml' },
  { framework: 'desktop', file: 'desktop/src/defaults/.github/workflows/build.yml' },
  { framework: 'web', file: 'web/scaffold/.github/workflows/build.yml' },
  { framework: 'extension', file: 'extension/src/defaults/.github/workflows/publish.yml' },
];

/**
 * The leading comment block, every line before the first non-comment line.
 * @param {string} text - a workflow template.
 * @returns {string[]} the header lines.
 */
function header(text) {
  const lines = text.split('\n');
  const end = lines.findIndex((line) => !line.startsWith('#'));
  return lines.slice(0, end);
}

/**
 * The version step, parsed from its own block (the whole template carries
 * scaffold tokens only its writer renders), its run text with the template's
 * framework name folded out, since each workflow asks its own framework's bin.
 * @param {string} text - a workflow template.
 * @param {string} framework - the template's framework.
 * @returns {{name: string, run: string}|null} the step, or null when absent.
 */
function versionStep(text, framework) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^\s*- name: .*version/i.test(line));
  if (start === -1) {
    return null;
  }
  const indent = lines[start].indexOf('-');
  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && line.search(/\S/) <= indent) {
      break;
    }
    block.push(line);
  }
  const [step] = yaml.load(block.map((line) => line.slice(indent)).join('\n'));
  return { name: step.name, run: String(step.run).split(`@omega.js/${framework}/`).join('@omega.js/<framework>/') };
}

module.exports = defineCases({
  type: 'group',
  description: 'workflow-headers: the four CI templates share one header and one version step',
  tests: [
    {
      name: 'the templates carry the backend header and its Log versions step, Omega: line included',
      run: (ctx) => {
        const templates = TEMPLATES.map(({ framework, file }) => {
          const text = fs.readFileSync(path.join(PACKAGES_DIR, file), 'utf8');
          return { file, header: header(text), step: versionStep(text, framework) };
        });
        const [canonical] = templates;

        ctx.expect(canonical.step.name).toBe('Log versions');
        ctx.expect(canonical.step.run).toContain('echo "Omega: $(node ');

        for (const { file, header: lines, step } of templates) {
          ctx.expect(lines, `${file}: the header`).toEqual(canonical.header);
          ctx.expect(step, `${file}: the version step`).toEqual(canonical.step);
        }
      },
    },
  ],
});
