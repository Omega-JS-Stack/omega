/**
 * docs-links tests: every relative link in a markdown file resolves.
 *
 * Scans the `.md` files git tracks or would track under docs/, packages/
 * and agent-plugins/, plus the root README.md and AGENTS.md. A link whose target file or folder
 * is missing is a dangling link and fails here. Web URLs, site-absolute paths,
 * build aliases and same-page anchors are not repo paths, and code spans and
 * fences are not links.
 *
 * Run: node --test scripts/docs-links.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCOPES = ['docs/', 'packages/', 'agent-plugins/', 'README.md', 'AGENTS.md'];

// `[text](target)` with an optional title; the target is group 1.
const LINK = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
// A site URL (`/pricing`) or a build alias (`@post/hero.jpg`) is not a repo path.
const NOT_A_PATH = /^([a-z][a-z0-9+.-]*:|#|\/|@)/i;

// The markdown with fenced blocks and inline code spans blanked out.
function stripCode(markdown) {
  return markdown
    .replace(/^(```|~~~)[\s\S]*?^\1/gm, '')
    .replace(/(`+)[^\n]*?\1/g, '');
}

/**
 * The relative link targets in one markdown file that resolve to nothing.
 *
 * @param {string} file - Absolute path of the markdown file
 * @returns {string[]} - The dangling targets, as written
 */
function danglingLinks(file) {
  const markdown = stripCode(fs.readFileSync(file, 'utf8'));
  const dangling = [];
  for (const [, target] of markdown.matchAll(LINK)) {
    if (NOT_A_PATH.test(target)) continue;
    const bare = decodeURIComponent(target.split('#')[0].split('?')[0]);
    if (!fs.existsSync(path.resolve(path.dirname(file), bare))) {
      dangling.push(target);
    }
  }
  return dangling;
}

test('danglingLinks() flags a missing path and passes real paths, URLs, anchors and code', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'docs-links-'));
  fs.writeFileSync(path.join(dir, 'there.md'), '# there\n');
  fs.writeFileSync(path.join(dir, 'page.md'), [
    '[ok](there.md#part) [web](https://example.com) [top](#title) [mail](mailto:a@b.c)',
    '[gone](missing.md) `[code](nope.md)` ```` ``` ```` [site](/pricing) [alias](@post/a.jpg)',
    '```', '[fenced](nope.md)', '```',
  ].join('\n'));
  assert.deepEqual(danglingLinks(path.join(dir, 'page.md')), ['missing.md']);
  fs.rmSync(dir, { recursive: true });
});

test('no markdown file has a dangling relative link', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...SCOPES], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file.endsWith('.md') && fs.existsSync(path.join(ROOT, file)));
  const dangling = files.flatMap((file) => danglingLinks(path.join(ROOT, file))
    .map((target) => `${file}: ${target}`));
  assert.deepEqual(dangling, []);
});
