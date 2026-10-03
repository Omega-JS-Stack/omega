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
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'skill-descriptions',
  tests: [
    // --- parser self-tests ---

    {
      name: 'parser: a plain inline description is read',
      run: (ctx) => {
        const source = '---\nname: web\ndescription: Use when working on a website app.\nuser-invocable: true\n---\n\nBody.\n';
        ctx.expect(readDescription(source)).toBe('Use when working on a website app.');
      },
    },

    {
      name: 'parser: a folded block scalar is joined into one line',
      run: (ctx) => {
        const source = '---\nname: web\ndescription: >-\n  Use when working on a\n  website app.\nuser-invocable: true\n---\n';
        ctx.expect(readDescription(source)).toBe('Use when working on a website app.');
      },
    },

    {
      name: 'parser: a literal block scalar is joined into one line',
      run: (ctx) => {
        const source = '---\nname: web\ndescription: |\n  Use when working on a\n  website app.\n---\n';
        ctx.expect(readDescription(source)).toBe('Use when working on a website app.');
      },
    },

    {
      name: 'parser: an indented continuation of an inline value is joined',
      run: (ctx) => {
        const source = '---\nname: web\ndescription: Use when working\n  on a website app.\n---\n';
        ctx.expect(readDescription(source)).toBe('Use when working on a website app.');
      },
    },

    {
      name: 'parser: the body is never read as frontmatter',
      run: (ctx) => {
        const source = '---\nname: web\ndescription: Short.\n---\n\ndescription: not this one\n';
        ctx.expect(readDescription(source)).toBe('Short.');
      },
    },

    {
      name: 'parser: a file with no frontmatter has no description',
      run: (ctx) => {
        ctx.expect(readDescription('# Just a heading\n')).toBe(null);
      },
    },

    // --- the live scan ---

    {
      name: 'skills: every SKILL.md carries a description',
      run: (ctx) => {
        const missing = skillNames().filter((skill) => {
          const source = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
          return !readDescription(source);
        });

        ctx.expect(missing, `SKILL.md files with no frontmatter description: ${missing.join(', ')}`).toEqual([]);
      },
    },

    {
      name: 'skills: omega:init ships, and its description is one sentence',
      run: (ctx) => {
        const file = path.join(SKILLS_DIR, 'init', 'SKILL.md');
        ctx.expect(fs.existsSync(file), 'agent-plugins/claude/skills/init/SKILL.md exists').toBeTruthy();

        const description = readDescription(fs.readFileSync(file, 'utf8')) || '';
        ctx.expect(description, `one sentence ends the description: ${description}`).toMatch(/[.!?]$/);
        ctx.expect(description, `no second sentence starts inside it: ${description}`).not.toMatch(/[.!?]\s/);
      },
    },

    {
      name: `skills: no description exceeds ${MAX_DESCRIPTION} characters`,
      run: (ctx) => {
        const over = [];

        for (const skill of skillNames()) {
          const source = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
          const description = readDescription(source);
          if (description && description.length > MAX_DESCRIPTION) {
            over.push(`${skill}: ${description.length} chars`);
          }
        }

        ctx.expect(over, `descriptions over the ${MAX_DESCRIPTION}-char cap:\n  ${over.join('\n  ')}`).toEqual([]);
      },
    },
  ],
});
