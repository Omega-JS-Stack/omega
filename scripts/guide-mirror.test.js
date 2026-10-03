/**
 * guide-mirror tests: the four framework guides mirror each other.
 *
 * `docs/<framework>/index.md` for web, backend, desktop and extension carry
 * their shared `##` sections in the same order, and a section more than one
 * guide carries is in all four unless OMITTED names the guide that leaves it
 * out. A section only one guide carries is that framework's own. Each guide
 * also names its playground target as the designated test consumer, in the
 * same words.
 *
 * Run: node --test scripts/guide-mirror.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GUIDES = ['web', 'backend', 'desktop', 'extension'];
// The backend runs server-side and hands no page a client instance to read.
const OMITTED = { '🚨 READ @omega.js/client TOO': ['backend'] };

function readGuide(name) {
  return fs.readFileSync(path.join(ROOT, 'docs', name, 'index.md'), 'utf8');
}

// The markdown with fenced blocks blanked out, so a `#` line in code is no heading.
function stripFences(markdown) {
  return markdown.replace(/^(```|~~~)[\s\S]*?^\1/gm, '');
}

/**
 * The `##` section headings of one guide, in order.
 *
 * @param {string} markdown - The guide's text
 * @returns {string[]} - The heading texts
 */
function sections(markdown) {
  return [...stripFences(markdown).matchAll(/^## (.+)$/gm)].map(([, heading]) => heading.trim());
}

/**
 * Where the guides break the mirror.
 *
 * @param {Object<string, string[]>} guides - Guide name to its section headings
 * @param {Object<string, string[]>} omitted - Heading to the guides that leave it out on purpose
 * @returns {string[]} - One line per break
 */
function mirrorFindings(guides, omitted) {
  const names = Object.keys(guides);
  const carriers = (heading) => names.filter((name) => guides[name].includes(heading));
  const shared = [...new Set(names.flatMap((name) => guides[name]))].filter((heading) => carriers(heading).length > 1);
  const findings = [];
  for (const heading of shared) {
    for (const name of names) {
      const leftOut = (omitted[heading] || []).includes(name);
      if (!guides[name].includes(heading) && !leftOut) findings.push(`${name}: missing the shared section "${heading}"`);
      if (guides[name].includes(heading) && leftOut) findings.push(`${name}: carries "${heading}", which OMITTED says it leaves out`);
    }
  }
  names.forEach((a, index) => names.slice(index + 1).forEach((b) => {
    const inA = guides[a].filter((heading) => guides[b].includes(heading));
    const inB = guides[b].filter((heading) => guides[a].includes(heading));
    if (inA.join('\n') !== inB.join('\n')) {
      findings.push(`${a} vs ${b}: shared sections in a different order (${inA.join(', ')} / ${inB.join(', ')})`);
    }
  }));
  return findings;
}

module.exports = defineCases({
  type: 'group',
  description: 'guide-mirror',
  tests: [
    {
      name: 'mirrorFindings() passes a mirror and a single-guide section',
      run: (ctx) => {
        const guides = {
          a: ['Identity', 'Only A', 'CLI', 'Docs'],
          b: ['Identity', 'CLI', 'Only B', 'Docs'],
        };
        ctx.expect(mirrorFindings(guides, {})).toEqual([]);
      },
    },

    {
      name: 'mirrorFindings() flags a shared section one guide lacks',
      run: (ctx) => {
        const guides = {
          a: ['Identity', 'Client', 'CLI'],
          b: ['Identity', 'Client', 'CLI'],
          c: ['Identity', 'CLI'],
        };
        ctx.expect(mirrorFindings(guides, {})).toEqual(['c: missing the shared section "Client"']);
        ctx.expect(mirrorFindings(guides, { Client: ['c'] })).toEqual([]);
      },
    },

    {
      name: 'mirrorFindings() flags an omission the guide no longer makes',
      run: (ctx) => {
        const guides = { a: ['Identity', 'Client'], b: ['Identity', 'Client'] };
        ctx.expect(mirrorFindings(guides, { Client: ['b'] })).toEqual(['b: carries "Client", which OMITTED says it leaves out']);
      },
    },

    {
      name: 'mirrorFindings() flags shared sections out of order',
      run: (ctx) => {
        const guides = {
          a: ['Identity', 'CLI', 'Docs'],
          b: ['Identity', 'Docs', 'CLI'],
        };
        ctx.expect(mirrorFindings(guides, {})).toEqual([
          'a vs b: shared sections in a different order (Identity, CLI, Docs / Identity, Docs, CLI)',
        ]);
      },
    },

    {
      name: 'the four framework guides mirror each other section for section',
      run: (ctx) => {
        const guides = Object.fromEntries(GUIDES.map((name) => [name, sections(readGuide(name))]));
        ctx.expect(mirrorFindings(guides, OMITTED)).toEqual([]);
      },
    },

    {
      name: 'every guide names its playground target as the designated test consumer, in the same words',
      run: (ctx) => {
        const lines = GUIDES.map((name) => {
          const markdown = readGuide(name);
          const start = markdown.indexOf('### For Framework Development');
          const section = markdown.slice(start, markdown.indexOf('\n## ', start));
          const line = section.split('\n').find((text) => text.includes('designated test consumer'));
          ctx.expect(start !== -1 && line, `${name}: no designated test consumer under For Framework Development`).toBeTruthy();
          ctx.expect(line.includes(`brands/playground-omega/targets/${name}`), `${name}: the consumer is not its playground target`).toBeTruthy();
          return line.replace(/^\d+\.\s*/, '').replace(new RegExp(`\\b${name}\\b`, 'g'), '<framework>');
        });
        ctx.expect(new Set(lines).size, `the four lines differ:\n${lines.join('\n')}`).toBe(1);
      },
    },
  ],
});
