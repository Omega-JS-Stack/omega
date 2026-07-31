/**
 * skill-description length test — every skill's frontmatter `description` is
 * resident in EVERY session (the listing Claude reads before it chooses to load
 * anything), so the descriptions are a shared context budget, not free text
 * ([#140](https://github.com/Omega-JS-Stack/omega/issues/140)).
 *
 * A description is one tight trigger sentence: when to invoke the skill. The
 * detail belongs in the skill body and the framework docs. This caps the
 * sentence at 300 characters and fails hard on anything longer.
 *
 * Two layers: parser self-tests over synthetic frontmatter (plain, folded, and
 * literal scalars), then the live scan over every real SKILL.md.
 *
 * Run: node --test scripts/skill-descriptions.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'agent-plugins', 'claude', 'skills');

const MAX_DESCRIPTION = 300;

/**
 * Read the `description` out of a SKILL.md's frontmatter. Handles the plain
 * inline scalar plus the folded/literal block shapes (`>-`, `|`), whose
 * continuation lines are indented under the key.
 *
 * @param {string} source - The whole SKILL.md, frontmatter and body
 * @returns {string|null} The description, folded to one line; null when absent
 */
function readDescription(source) {
  const lines = source.split('\n');
  if (lines[0].trim() !== '---') return null;

  const end = lines.indexOf('---', 1);
  if (end === -1) return null;

  const frontmatter = lines.slice(1, end);
  const start = frontmatter.findIndex((line) => /^description:/.test(line));
  if (start === -1) return null;

  const first = frontmatter[start].replace(/^description:\s*/, '');
  const block = /^[>|][-+]?$/.test(first);
  const parts = block ? [] : [first];

  for (const line of frontmatter.slice(start + 1)) {
    if (!/^\s/.test(line)) break;
    parts.push(line.trim());
  }

  return parts.join(' ').trim();
}

/**
 * Skill names the plugin ships — the directory listing IS the roster.
 *
 * @returns {string[]} Bare skill names
 */
function skillNames() {
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((item) => item.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, item.name, 'SKILL.md')))
    .map((item) => item.name);
}

// --- parser self-tests ---

test('parser: a plain inline description is read', () => {
  const source = '---\nname: web\ndescription: Use when working on a website app.\nuser-invocable: true\n---\n\nBody.\n';
  assert.equal(readDescription(source), 'Use when working on a website app.');
});

test('parser: a folded block scalar is joined into one line', () => {
  const source = '---\nname: web\ndescription: >-\n  Use when working on a\n  website app.\nuser-invocable: true\n---\n';
  assert.equal(readDescription(source), 'Use when working on a website app.');
});

test('parser: a literal block scalar is joined into one line', () => {
  const source = '---\nname: web\ndescription: |\n  Use when working on a\n  website app.\n---\n';
  assert.equal(readDescription(source), 'Use when working on a website app.');
});

test('parser: an indented continuation of an inline value is joined', () => {
  const source = '---\nname: web\ndescription: Use when working\n  on a website app.\n---\n';
  assert.equal(readDescription(source), 'Use when working on a website app.');
});

test('parser: the body is never read as frontmatter', () => {
  const source = '---\nname: web\ndescription: Short.\n---\n\ndescription: not this one\n';
  assert.equal(readDescription(source), 'Short.');
});

test('parser: a file with no frontmatter has no description', () => {
  assert.equal(readDescription('# Just a heading\n'), null);
});

// --- the live scan ---

test('skills: every SKILL.md carries a description', () => {
  const missing = skillNames().filter((skill) => {
    const source = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
    return !readDescription(source);
  });

  assert.deepEqual(missing, [], `SKILL.md files with no frontmatter description: ${missing.join(', ')}`);
});

test(`skills: no description exceeds ${MAX_DESCRIPTION} characters`, () => {
  const over = [];

  for (const skill of skillNames()) {
    const source = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
    const description = readDescription(source);
    if (description && description.length > MAX_DESCRIPTION) {
      over.push(`${skill}: ${description.length} chars`);
    }
  }

  assert.deepEqual(over, [], `descriptions over the ${MAX_DESCRIPTION}-char cap:\n  ${over.join('\n  ')}`);
});
