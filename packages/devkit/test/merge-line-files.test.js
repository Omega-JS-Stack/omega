// Unit tests for src/merge-line-files.js — the OMEGA marker-section merge protocol.
// Mirrors the coverage of EM's build-layer suite (which now tests through its shim).

const defineCases = require('@omega.js/devkit/test/define-cases');
const { mergeLineBasedFiles, normalizeEnvLine, hasSectionMarkers, getCustomSection, sectionMarkers, DEFAULT_MARKER, CUSTOM_MARKER } = require('../src/merge-line-files');

// ─── test/README.md: the texts the frameworks shipped before the markers ─────

const jetpack = require('fs-jetpack');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const shippedReadme = (name) => jetpack.read(path.join(__dirname, 'fixtures', 'shipped-readme', `${name}.md`));
const readmeTemplate = (framework) => jetpack.read(path.join(REPO, 'packages', framework, 'src', 'defaults', 'test', 'README.md'));
const README_CUSTOM = sectionMarkers('README.md').customMarker;

// The Default part of a merged README (through the Custom marker line), and what follows it.
function splitReadme(content) {
  const at = content.indexOf(`${README_CUSTOM}\n`) + README_CUSTOM.length + 1;
  return { head: content.slice(0, at), custom: content.slice(at) };
}

// ─── test/README.md: the first converge reads blocks, not lines ─────────────

// The extension's old shipped text with the brand's own section after it, converged against today's template.
const convergeExtension = (brand) => splitReadme(mergeLineBasedFiles(`${shippedReadme('extension-b9d9aeda').trimEnd()}\n\n${brand}\n`, readmeTemplate('extension'), 'README.md')).custom;

// ─── .env: the value dotenv reads never changes ──────────────────────────────

const dotenv = require('dotenv');

module.exports = defineCases({
  type: 'group',
  description: 'merge-line-files',
  tests: [
    {
      name: 'preserves user value in default section across merges (and quotes it)',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\nGH_TOKEN=ghp_secret123\nBACKEND_MANAGER_KEY=\n\n${CUSTOM_MARKER}\n`;
        const incoming = `${DEFAULT_MARKER}\nGH_TOKEN=""\nBACKEND_MANAGER_KEY=""\n\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        ctx.expect(merged).toMatch(/GH_TOKEN="ghp_secret123"/);
      },
    },

    {
      name: 'adds new framework default keys the user does not have',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\nOLD_KEY="kept"\n${CUSTOM_MARKER}\n`;
        const incoming = `${DEFAULT_MARKER}\nOLD_KEY=""\nNEW_KEY=""\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        ctx.expect(merged).toMatch(/OLD_KEY="kept"/);
        ctx.expect(merged).toMatch(/NEW_KEY=""/);
      },
    },

    {
      name: '.env: a VALUED retired default-section key migrates to the custom section',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\nFRAMEWORK_KEY=""\nUSER_KEY="mine"\n${CUSTOM_MARKER}\n`;
        const incoming = `${DEFAULT_MARKER}\nFRAMEWORK_KEY=""\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
        ctx.expect(customPart).toMatch(/USER_KEY="mine"/);
      },
    },

    {
      name: '.env: an EMPTY retired default-section key drops instead of migrating (#926)',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\nFRAMEWORK_KEY=""\nRETIRED_BARE=\nRETIRED_QUOTED=""\nUSER_KEY="mine"\n${CUSTOM_MARKER}\n`;
        const incoming = `${DEFAULT_MARKER}\nFRAMEWORK_KEY=""\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        ctx.expect(merged, 'an empty retired key carries no data to keep').not.toMatch(/RETIRED_BARE/);
        ctx.expect(merged).not.toMatch(/RETIRED_QUOTED/);
        ctx.expect(merged.slice(merged.indexOf(CUSTOM_MARKER)), 'a valued one still migrates').toMatch(/USER_KEY="mine"/);
      },
    },

    {
      name: 'custom section is preserved verbatim (env values normalized to quotes)',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\nA=""\n${CUSTOM_MARKER}\n# my note\nMY_SECRET=raw value\n`;
        const incoming = `${DEFAULT_MARKER}\nA=""\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        ctx.expect(merged).toMatch(/# my note/);
        ctx.expect(merged).toMatch(/MY_SECRET="raw value"/);
      },
    },

    {
      name: 'custom key newly adopted by the framework is promoted UP into default (@omega.js/backend behavior)',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\n${CUSTOM_MARKER}\nGH_TOKEN="moved"\n`;
        const incoming = `${DEFAULT_MARKER}\nGH_TOKEN=""\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        const defaultPart = merged.slice(0, merged.indexOf(CUSTOM_MARKER));
        const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
        ctx.expect(defaultPart).toMatch(/GH_TOKEN="moved"/);
        ctx.expect(customPart).not.toMatch(/GH_TOKEN/);
        // Promotion is idempotent: the next merge preserves the value from Default.
        const again = mergeLineBasedFiles(merged, incoming, '.env');
        ctx.expect(again).toBe(merged);
      },
    },

    {
      name: 'key present in BOTH sections: default value wins, custom copy is kept (no silent value flip)',
      run: (ctx) => {
        // dotenv resolves the LAST occurrence, so the effective value was the custom
        // "b". Dropping the custom copy would flip the effective value to "a" — keep it.
        const existing = `${DEFAULT_MARKER}\nGH_TOKEN="a"\n${CUSTOM_MARKER}\nGH_TOKEN="b"\n`;
        const incoming = `${DEFAULT_MARKER}\nGH_TOKEN=""\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        const defaultPart = merged.slice(0, merged.indexOf(CUSTOM_MARKER));
        const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
        ctx.expect(defaultPart).toMatch(/GH_TOKEN="a"/);
        ctx.expect(customPart).toMatch(/GH_TOKEN="b"/);
      },
    },

    {
      name: 'hasSectionMarkers: true only when both markers present',
      run: (ctx) => {
        ctx.expect(hasSectionMarkers(`${DEFAULT_MARKER}\n${CUSTOM_MARKER}\n`)).toBe(true);
        ctx.expect(hasSectionMarkers(`${DEFAULT_MARKER}\n`)).toBe(false);
        ctx.expect(hasSectionMarkers('KEY=value\n')).toBe(false);
        ctx.expect(hasSectionMarkers('')).toBe(false);
      },
    },

    {
      name: 'hasSectionMarkers: both markers must be whole lines, Default before Custom',
      run: (ctx) => {
        ctx.expect(hasSectionMarkers(`  ${DEFAULT_MARKER}\nA=\n${CUSTOM_MARKER}  \n`), 'surrounding whitespace is still a whole line').toBe(true);
        ctx.expect(hasSectionMarkers(`We split on ${DEFAULT_MARKER} and ${CUSTOM_MARKER} here.\n`), 'quoted inline is no marker').toBe(false);
        ctx.expect(hasSectionMarkers(`${CUSTOM_MARKER}\n${DEFAULT_MARKER}\n`), 'Custom above Default is no marked file').toBe(false);
        const md = sectionMarkers('AGENTS.md');
        ctx.expect(hasSectionMarkers(`Quote \`${md.defaultMarker}\` then \`${md.customMarker}\`.\n`, 'AGENTS.md')).toBe(false);
      },
    },

    {
      name: 'getCustomSection: the Custom marker counts only as a whole line',
      run: (ctx) => {
        const content = `${DEFAULT_MARKER}\nsee ${CUSTOM_MARKER} inline\n${CUSTOM_MARKER}\nmine\n`;
        ctx.expect(getCustomSection(content)).toBe('\nmine\n');
      },
    },

    {
      name: 'a marked file\'s lines above the Default marker land at the top of Custom, once',
      run: (ctx) => {
        const md = sectionMarkers('AGENTS.md');
        const incoming = `${md.defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${md.customMarker}\n`;

        const withNotes = `# My Project\n\n${md.defaultMarker}\n@../stale/AGENTS.md\n\n${md.customMarker}\nOur deploy needs the VPN up.\n`;
        const merged = mergeLineBasedFiles(withNotes, incoming, 'AGENTS.md');
        ctx.expect(merged).toBe(`${incoming}# My Project\n\nOur deploy needs the VPN up.\n`);
        ctx.expect(mergeLineBasedFiles(merged, incoming, 'AGENTS.md'), 'a second pass is identical').toBe(merged);

        const titleOnly = `# My Project\n${md.defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${md.customMarker}\n`;
        ctx.expect(mergeLineBasedFiles(titleOnly, incoming, 'AGENTS.md')).toBe(`${incoming}# My Project\n`);

        const gitignore = `my-dir/\n${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n*.log\n`;
        ctx.expect(mergeLineBasedFiles(gitignore, `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n`, '.gitignore')).toBe(`${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\nmy-dir/\n\n*.log\n`);
      },
    },

    {
      name: '.gitignore: a retired Default-block line DROPS, the Custom section is untouched (#926)',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\nnode_modules/\nconfig/certs/\n${CUSTOM_MARKER}\n*.log\n`;
        const incoming = `${DEFAULT_MARKER}\nnode_modules/\nconfig/certs/*\n!config/certs/README.md\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.gitignore');
        const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
        ctx.expect(merged, 'the retired line leaves the file entirely').not.toMatch(/^config\/certs\/$/m);
        ctx.expect(merged).toMatch(/^config\/certs\/\*$/m);
        ctx.expect(merged).toMatch(/^!config\/certs\/README\.md$/m);
        ctx.expect(customPart).toMatch(/\*\.log/);
      },
    },

    {
      name: '.gitignore: the new rule is idempotent (second pass identical) (#926)',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\nnode_modules/\nconfig/certs/\n${CUSTOM_MARKER}\n*.log\n`;
        const incoming = `${DEFAULT_MARKER}\nnode_modules/\nconfig/certs/*\n${CUSTOM_MARKER}\n`;
        const once = mergeLineBasedFiles(existing, incoming, '.gitignore');
        const twice = mergeLineBasedFiles(once, incoming, '.gitignore');
        ctx.expect(twice).toBe(once);
      },
    },

    {
      name: 'merge is idempotent: second pass returns identical content',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\nKEY=value with spaces\n${CUSTOM_MARKER}\nUSER=x\n`;
        const incoming = `${DEFAULT_MARKER}\nKEY=""\n${CUSTOM_MARKER}\n`;
        const once = mergeLineBasedFiles(existing, incoming, '.env');
        const twice = mergeLineBasedFiles(once, incoming, '.env');
        ctx.expect(twice).toBe(once);
      },
    },

    {
      name: 'pre-marker lines in a legacy file are treated as default section',
      run: (ctx) => {
        const existing = `LEGACY_KEY="old"\n`;
        const incoming = `${DEFAULT_MARKER}\nLEGACY_KEY=""\nNEW=""\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        ctx.expect(merged).toMatch(/LEGACY_KEY="old"/);
      },
    },

    {
      name: 'normalizeEnvLine: raw wraps, single-quote canonicalizes, empty quotes, double-quote untouched',
      run: (ctx) => {
        ctx.expect(normalizeEnvLine('KEY=raw')).toBe('KEY="raw"');
        ctx.expect(normalizeEnvLine("KEY='single'")).toBe('KEY="single"');
        ctx.expect(normalizeEnvLine('KEY="done"')).toBe('KEY="done"');
        ctx.expect(normalizeEnvLine('KEY=')).toBe('KEY=""');
        ctx.expect(normalizeEnvLine('# comment')).toBe('# comment');
        ctx.expect(normalizeEnvLine('KEY=has "quote"'), 'dotenv reads an embedded quote verbatim, so it is never escaped').toBe('KEY="has "quote""');
      },
    },

    {
      name: 'placeholder `# KEY=""`: existing SET value keeps its line in default (either section)',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\nOMEGA_ADMIN_KEY="real-value"\n${CUSTOM_MARKER}\nCUSTOM_TOKEN="user-set"\n`;
        const incoming = `${DEFAULT_MARKER}\n# OMEGA_ADMIN_KEY=""\n# CUSTOM_TOKEN=""\n# NEVER_SET=""\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');

        ctx.expect(merged, 'default-section value survives the placeholder').toMatch(/OMEGA_ADMIN_KEY="real-value"/);
        ctx.expect(merged, 'custom-section value is promoted into default').toMatch(/CUSTOM_TOKEN="user-set"/);
        ctx.expect(merged, 'no duplicate placeholder for a set key').not.toMatch(/# OMEGA_ADMIN_KEY=/);
        ctx.expect(merged, 'unset key stays a commented placeholder').toMatch(/# NEVER_SET=""/);
        const customHalf = merged.slice(merged.indexOf(CUSTOM_MARKER));
        ctx.expect(customHalf, 'promoted key drops out of custom').not.toMatch(/CUSTOM_TOKEN/);
      },
    },

    {
      name: 'placeholder `# KEY=""`: existing EMPTY values converge to the placeholder instead of migrating to custom (friction #20)',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\nOMEGA_ADMIN_KEY=""\nOMEGA_WEBHOOK_KEY=\n${CUSTOM_MARKER}\n`;
        const incoming = `${DEFAULT_MARKER}\n# OMEGA_ADMIN_KEY=""\n# OMEGA_WEBHOOK_KEY=""\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');

        ctx.expect(merged, 'quoted-empty converges to the placeholder').toMatch(/# OMEGA_ADMIN_KEY=""/);
        ctx.expect(merged, 'bare-empty converges to the placeholder').toMatch(/# OMEGA_WEBHOOK_KEY=""/);
        ctx.expect(merged, 'the shadowing empty line is gone').not.toMatch(/^OMEGA_ADMIN_KEY=/m);
        const customHalf = merged.slice(merged.indexOf(CUSTOM_MARKER));
        ctx.expect(customHalf, 'empties never migrate into custom').not.toMatch(/OMEGA_/);
      },
    },

    {
      name: 'placeholder merge is idempotent',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}\nSET_KEY="v"\nEMPTY_KEY=""\n${CUSTOM_MARKER}\nMINE="x"\n`;
        const incoming = `${DEFAULT_MARKER}\n# SET_KEY=""\n# EMPTY_KEY=""\n${CUSTOM_MARKER}\n`;
        const once = mergeLineBasedFiles(existing, incoming, '.env');
        const twice = mergeLineBasedFiles(once, incoming, '.env');
        ctx.expect(twice).toBe(once);
      },
    },

    {
      name: 'placeholder: `# KEY=""` and a bare `# KEY=` are both the framework\'s own, so neither lands in Custom',
      run: (ctx) => {
        const incoming = `${DEFAULT_MARKER}\n# A=""\n# B=""\n\n${CUSTOM_MARKER}\n`;

        for (const existing of [
          `${DEFAULT_MARKER}\n# A=\n# B=\n\n${CUSTOM_MARKER}\n`,
          '# A=\n# B=""\n# RETIRED=""\n# GONE=\n',
        ]) {
          const merged = mergeLineBasedFiles(existing, incoming, '.env');
          ctx.expect(merged, JSON.stringify(merged)).toBe(incoming);
        }
      },
    },

    {
      name: 'getCustomSection: returns everything after the Custom marker, and "" without markers',
      run: (ctx) => {
        const content = `${DEFAULT_MARKER}\nframework\n${CUSTOM_MARKER}\nmy notes\n`;
        ctx.expect(getCustomSection(content)).toBe('\nmy notes\n');
        ctx.expect(getCustomSection('no markers here')).toBe('');
        ctx.expect(getCustomSection(null)).toBe('');
      },
    },

    // ─── One grammar, three comment flavors ──────────────────────────────────────

    {
      name: 'sectionMarkers: markdown takes the HTML-comment flavor of the one grammar, every other file the # flavor',
      run: (ctx) => {
        ctx.expect(sectionMarkers('AGENTS.md')).toEqual({
          defaultMarker: '<!-- ========== Default Values ========== -->',
          customMarker: '<!-- ========== Custom Values ========== -->',
        });
        ctx.expect(sectionMarkers('.gitignore')).toEqual({ defaultMarker: DEFAULT_MARKER, customMarker: CUSTOM_MARKER });
        ctx.expect(sectionMarkers('.gitattributes')).toEqual({ defaultMarker: DEFAULT_MARKER, customMarker: CUSTOM_MARKER });
      },
    },

    {
      name: 'markdown flavor: the Default section is rewritten, the Custom section kept, a second pass identical',
      run: (ctx) => {
        const { defaultMarker, customMarker } = sectionMarkers('AGENTS.md');
        const existing = `${defaultMarker}\n@../../stale/AGENTS.md\n\n${customMarker}\n# My notes\n\nKeep ${DEFAULT_MARKER} quoted.\n`;
        const incoming = `${defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${customMarker}\n`;

        const merged = mergeLineBasedFiles(existing, incoming, 'AGENTS.md');
        ctx.expect(merged).toBe(`${defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${customMarker}\n# My notes\n\nKeep ${DEFAULT_MARKER} quoted.\n`);
        ctx.expect(mergeLineBasedFiles(merged, incoming, 'AGENTS.md')).toBe(merged);
        ctx.expect(hasSectionMarkers(merged, 'AGENTS.md')).toBe(true);
        ctx.expect(hasSectionMarkers(merged), 'the # flavor is a different marker pair').toBe(false);
        ctx.expect(getCustomSection(merged, 'AGENTS.md')).toBe(`\n# My notes\n\nKeep ${DEFAULT_MARKER} quoted.\n`);
      },
    },

    // ─── The shipped Custom boilerplate leaves ───────────────────────────────────

    {
      name: 'a marked Custom section that is exactly a shipped boilerplate block strips to its marker',
      run: (ctx) => {
        const incoming = `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n`;
        const generations = [
          `${CUSTOM_MARKER}\n# Add your custom ignore patterns below this line\n# ...\n`,
          `${CUSTOM_MARKER}\n\n# Add your own ignores below. This section is preserved across framework re-syncs.\n`,
          `${CUSTOM_MARKER}\n\n# Add your own ignores below. This section is preserved across \`npx omega setup\` runs.\n`,
          `${CUSTOM_MARKER}\n\n# Add your own ignores below. This section is preserved across \`npx mgr setup\` runs.\n`,
          `${CUSTOM_MARKER}\n# ...\n`,
        ];
        for (const custom of generations) {
          const merged = mergeLineBasedFiles(`${DEFAULT_MARKER}\nnode_modules/\n\n${custom}`, incoming, '.gitignore');
          ctx.expect(merged, JSON.stringify(custom)).toBe(incoming);
        }
      },
    },

    {
      name: 'a marked Custom section holding anything beyond the boilerplate stays verbatim on every run',
      run: (ctx) => {
        const incoming = `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n`;
        for (const custom of [
          '# Add your custom ignore patterns below this line\n# ...\nmy-secret-dir/\n',
          '# ...\nmy-secret-dir/\n',
          '# my own ignores\n# ...\n',
        ]) {
          const existing = `${incoming}${custom}`;
          ctx.expect(mergeLineBasedFiles(existing, incoming, '.gitignore'), JSON.stringify(custom)).toBe(existing);
        }

        const md = sectionMarkers('AGENTS.md');
        const agents = `${md.defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${md.customMarker}\n## Project-specific notes\n\nOur deploy needs the VPN up.\n`;
        const agentsIncoming = `${md.defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${md.customMarker}\n`;
        ctx.expect(mergeLineBasedFiles(agents, agentsIncoming, 'AGENTS.md')).toBe(agents);
      },
    },

    // ─── The first converge of an unmarked file ──────────────────────────────────

    {
      name: 'unmarked .gitignore: framework lines go to Default, every other line to Custom, nothing duplicated',
      run: (ctx) => {
        const incoming = `${DEFAULT_MARKER}\n# Dependencies\nnode_modules/\n\n# Secrets\n.env\n.env.*\n\n${CUSTOM_MARKER}\n`;
        const existing = [
          'node_modules/',
          'test/e2e/.logs/',
          '',
          '# An older generation\'s header over framework lines only',
          '.env',
          '',
          '# Secrets',
          '.env.local',
          '',
          '# my own block',
          '*.log',
        ].join('\n');

        const merged = mergeLineBasedFiles(existing, incoming, '.gitignore');
        ctx.expect(merged).toBe(`${incoming}test/e2e/.logs/\n\n.env.local\n\n# my own block\n*.log\n`);
        ctx.expect(mergeLineBasedFiles(merged, incoming, '.gitignore'), 'a second pass is identical').toBe(merged);
      },
    },

    {
      name: 'unmarked file holding exactly the framework lines converges to the template',
      run: (ctx) => {
        const incoming = `${DEFAULT_MARKER}\n# Translation caches\ntranslations/** linguist-generated=true\n\n${CUSTOM_MARKER}\n`;
        const existing = '# Translation caches (an older wording)\ntranslations/** linguist-generated=true\n';
        ctx.expect(mergeLineBasedFiles(existing, incoming, '.gitattributes')).toBe(incoming);
        ctx.expect(mergeLineBasedFiles('', incoming, '.gitattributes')).toBe(incoming);
      },
    },

    {
      name: 'unmarked README: backend\'s old shipped text at b9d9aeda converges to the template with an empty Custom section',
      run: (ctx) => {
        const template = readmeTemplate('backend');
        const merged = mergeLineBasedFiles(shippedReadme('backend-b9d9aeda'), template, 'README.md');
        const { head, custom } = splitReadme(merged);
        ctx.expect(head, 'the Default section is the template\'s').toBe(splitReadme(template).head);
        ctx.expect(custom.trim(), `no old framework line lands under Custom: ${JSON.stringify(custom)}`).toBe('');
      },
    },

    {
      name: 'unmarked README: every other old shipped text converges against its own template with an empty Custom section',
      run: (ctx) => {
        for (const [fixture, framework] of [['backend-6c7d9c96', 'backend'], ['desktop-b9d9aeda', 'desktop'], ['extension-b9d9aeda', 'extension']]) {
          const merged = mergeLineBasedFiles(shippedReadme(fixture), readmeTemplate(framework), 'README.md');
          const { custom } = splitReadme(merged);
          ctx.expect(custom.trim(), `${fixture}: ${JSON.stringify(custom)}`).toBe('');
        }
      },
    },

    {
      name: 'unmarked README: an old shipped text plus a paragraph the brand wrote keeps exactly that paragraph under Custom',
      run: (ctx) => {
        const paragraph = 'Our staging suites need the VPN up.\nRun `npm run seed` before `npm test`.';
        const existing = `${shippedReadme('backend-b9d9aeda').trimEnd()}\n\n${paragraph}\n`;
        const merged = mergeLineBasedFiles(existing, readmeTemplate('backend'), 'README.md');
        ctx.expect(splitReadme(merged).custom.trim()).toBe(paragraph);
      },
    },

    {
      name: 'marked README: a Custom section holding an old shipped line stays verbatim',
      run: (ctx) => {
        const template = readmeTemplate('backend');
        const existing = `${template}Drop your project test suites here. The framework auto-runs them alongside its own when you run \`npx mgr test\`.\n| \`test/routes/\` | Custom HTTP route handlers (\`functions/routes/<verb>/<path>.js\`) |\n`;
        ctx.expect(mergeLineBasedFiles(existing, template, 'README.md')).toBe(existing);
      },
    },

    {
      name: 'the shipped README lines apply only to README.md: a .gitignore keeps one',
      run: (ctx) => {
        const incoming = `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n`;
        const existing = 'node_modules/\n\n# Project tests\ntest/.output/\n';
        ctx.expect(mergeLineBasedFiles(existing, incoming, '.gitignore')).toBe(`${incoming}# Project tests\ntest/.output/\n`);
      },
    },

    {
      name: 'unmarked README: a brand code block whose lines equal framework lines lands whole under Custom',
      run: (ctx) => {
        const brand = [
          '## Seeding',
          '',
          'Our build suites seed a local store first:',
          '',
          '```js',
          'beforeEach(() => {',
          '  seed.reset();',
          '});',
          'module.exports = {',
          '  layer: \'build\',',
          '};',
          '```',
        ].join('\n');
        ctx.expect(convergeExtension(brand).trim()).toBe(brand);
      },
    },

    {
      name: 'unmarked README: a blank line inside a brand code block is kept where it was',
      run: (ctx) => {
        const brand = [
          '## Seeding',
          '',
          '```js',
          'beforeEach(() => {',
          '  seed.reset();',
          '});',
          '',
          'module.exports = {',
          '  layer: \'build\',',
          '};',
          '```',
        ].join('\n');
        ctx.expect(convergeExtension(brand).trim()).toBe(brand);
      },
    },

    {
      name: 'unmarked README: a brand table whose separator equals the framework\'s lands whole, in order',
      run: (ctx) => {
        const brand = [
          '## Our suites',
          '',
          '| Suite | Store | Owner |',
          '|---|---|---|',
          '| `test/build/seed.test.js` | Local | Platform team |',
          '| `test/boot/smoke.test.js` | None | QA |',
        ].join('\n');
        ctx.expect(convergeExtension(brand).trim()).toBe(brand);
      },
    },

    {
      name: 'unmarked README: a brand row added to a framework table lands alone under Custom',
      run: (ctx) => {
        const row = '| `test/fixtures/` | Plain Node | Static data the build suites read |';
        const shipped = shippedReadme('extension-b9d9aeda');
        const after = '| `test/boot/` | Consumer\'s actual built extension | End-to-end smoke tests (does the extension load, does the background register, do views render) |\n';
        ctx.expect(shipped.includes(after), 'the fixture still holds the row the brand row follows').toBeTruthy();
        const merged = mergeLineBasedFiles(shipped.replace(after, `${after}${row}\n`), readmeTemplate('extension'), 'README.md');
        ctx.expect(splitReadme(merged).custom.trim()).toBe(row);
      },
    },

    {
      name: 'unmarked README: a framework heading over a body all the brand\'s lands with that body under Custom',
      run: (ctx) => {
        const shipped = shippedReadme('extension-b9d9aeda');
        const frameworkSeeAlso = shipped.slice(shipped.indexOf('## See also'));
        const brandSeeAlso = '## See also\n\nOur runbook at `docs/testing.md` covers the staging store.\n';
        const merged = mergeLineBasedFiles(shipped.replace(frameworkSeeAlso, brandSeeAlso), readmeTemplate('extension'), 'README.md');
        ctx.expect(splitReadme(merged).custom.trim()).toBe('## See also\n\nOur runbook at `docs/testing.md` covers the staging store.');
      },
    },

    {
      name: 'unmarked README: a framework code block copied unchanged goes whole, nothing of it under Custom',
      run: (ctx) => {
        const template = readmeTemplate('extension');
        const open = template.indexOf('```js\n');
        const block = template.slice(open, template.indexOf('\n```\n', open) + 4);
        ctx.expect(block.startsWith('```js\n') && block.endsWith('\n```'), 'the template still carries a fenced example').toBeTruthy();
        const merged = mergeLineBasedFiles(`Our build suites follow the framework example:\n\n${block}\n`, template, 'README.md');
        ctx.expect(splitReadme(merged).custom.trim()).toBe('Our build suites follow the framework example:');
      },
    },

    {
      name: 'normalizeEnvLine: the double-quoted form never changes the value dotenv reads',
      run: (ctx) => {
        const lines = [
          'KEY=abc # note',
          'KEY=a\\b',
          'KEY=he said "hi"',
          'KEY=  lead',
          'KEY="x" # c',
          'KEY=a#b',
          "KEY='a\\nb'",
          "KEY='single' # c",
          'KEY=`tick`',
          '  KEY=indented',
          'export KEY=exported',
          'KEY="a\nb"',
        ];
        for (const line of lines) {
          const normalized = normalizeEnvLine(line);
          ctx.expect(dotenv.parse(normalized).KEY, `${JSON.stringify(line)} -> ${JSON.stringify(normalized)}`).toBe(dotenv.parse(line).KEY);
        }
        ctx.expect(normalizeEnvLine('KEY=abc # note'), 'an inline comment stays').toBe('KEY="abc" # note');
        ctx.expect(normalizeEnvLine('KEY=  lead')).toBe('KEY="lead"');
        ctx.expect(normalizeEnvLine("KEY='single' # c")).toBe('KEY="single" # c');
        ctx.expect(normalizeEnvLine("KEY='a\nb'"), 'a real newline is written as \\n, one line, as envLine writes it').toBe('KEY="a\\nb"');
      },
    },

    {
      name: '.env: a duplicated key keeps the LAST value, the one dotenv reads',
      run: (ctx) => {
        const incoming = `${DEFAULT_MARKER}\n# A=\nB=""\n${CUSTOM_MARKER}\n`;
        const existing = `${DEFAULT_MARKER}\nA="first"\nA="second"\nB="one"\nB="two"\n${CUSTOM_MARKER}\n`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        ctx.expect(dotenv.parse(merged)).toEqual({ A: 'second', B: 'two' });
      },
    },

    {
      name: '.env: a multi-line quoted value survives as one unit, in either section and on a first converge',
      run: (ctx) => {
        const cert = 'CERT="-----BEGIN KEY-----\nabc=\ndef\n-----END KEY-----"';
        const incoming = `${DEFAULT_MARKER}\n# CERT=\n# KNOWN=\n${CUSTOM_MARKER}\n`;

        for (const existing of [
          `${DEFAULT_MARKER}\n${cert}\nKNOWN="k"\n${CUSTOM_MARKER}\n`,
          `${DEFAULT_MARKER}\nKNOWN="k"\n${CUSTOM_MARKER}\n${cert.replace('CERT', 'MINE')}\n`,
          `${cert.replace('CERT', 'MINE')}\nKNOWN="k"\n`,
        ]) {
          const merged = mergeLineBasedFiles(existing, incoming, '.env');
          ctx.expect(dotenv.parse(merged), JSON.stringify(merged)).toEqual(dotenv.parse(existing));
          ctx.expect(mergeLineBasedFiles(merged, incoming, '.env'), 'a second pass is identical').toBe(merged);
        }
      },
    },

    {
      name: '.env: a value ending in a backslash before its quote closes on its own line when dotenv reads it there',
      run: (ctx) => {
        const incoming = `${DEFAULT_MARKER}\n# KNOWN=""\n${CUSTOM_MARKER}\n`;
        for (const [existing, neighbour] of [['MINE="x\\"\nB=raw\nOTHER="c"\n', 'B'], ['MINE="x\\"\nKNOWN="k"\nOTHER="c"\n', 'KNOWN']]) {
          const read = dotenv.parse(existing);
          const merged = mergeLineBasedFiles(existing, incoming, '.env');
          ctx.expect(dotenv.parse(merged), JSON.stringify(merged)).toEqual(read);
          ctx.expect(merged, 'the neighbour is its own unit, quoted').toMatch(new RegExp(`^${neighbour}="${read[neighbour]}"$`, 'm'));
          ctx.expect(merged.match(/^#?\s*KNOWN=/gm).length, 'no placeholder beside a set key').toBe(1);
        }

        // A later line closing the quote is the longer read dotenv takes: one unit.
        const spanning = 'MINE="x\\"\nB=raw"\n';
        ctx.expect(dotenv.parse(mergeLineBasedFiles(spanning, incoming, '.env'))).toEqual(dotenv.parse(spanning));
      },
    },

    {
      name: '.env first converge: a hand comment directly above an unknown key travels with it into Custom',
      run: (ctx) => {
        const incoming = `${DEFAULT_MARKER}\n# ── Known ──\n# KNOWN=\n\n${CUSTOM_MARKER}\n`;
        const existing = '# Known\nKNOWN="k"\n\n# my own token, rotated monthly\n# (ask ops)\nMINE="x"\nOTHER="y"\n';
        const merged = mergeLineBasedFiles(existing, incoming, '.env');

        ctx.expect(dotenv.parse(merged)).toEqual(dotenv.parse(existing));
        ctx.expect(merged.endsWith(`${CUSTOM_MARKER}\n# my own token, rotated monthly\n# (ask ops)\nMINE="x"\nOTHER="y"\n`), merged).toBeTruthy();
        ctx.expect(mergeLineBasedFiles(merged, incoming, '.env')).toBe(merged);
      },
    },

    {
      name: '.env first converge: the framework\'s own comment grammar above an unknown key stays behind',
      run: (ctx) => {
        const incoming = `${DEFAULT_MARKER}\n# ── Known ──\n# KNOWN=\n\n${CUSTOM_MARKER}\n`;
        const existing = '# ── Other keys (not in the canonical groups) ──\n# RETIRED=\n# my note\nMINE="x"\n';
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        ctx.expect(merged.endsWith(`${CUSTOM_MARKER}\n# my note\nMINE="x"\n`), merged).toBeTruthy();
      },
    },

    {
      name: '.env: an old generated header strips only on an unmarked file\'s first converge',
      run: (ctx) => {
        const header = '# Acme: brand secrets (gitignored; loaded before every omega run).\n# my note\n';
        const incoming = `${DEFAULT_MARKER}\n# KNOWN=\n\n${CUSTOM_MARKER}\n`;
        ctx.expect(mergeLineBasedFiles(header, incoming, '.env')).toBe(`${incoming}# my note\n`);

        const marked = `${incoming}${header}`;
        ctx.expect(mergeLineBasedFiles(marked, incoming, '.env'), 'a marked Custom section stays verbatim').toBe(marked);
        ctx.expect(mergeLineBasedFiles(header, `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n`, '.gitignore').endsWith(header), 'a .gitignore never strips the .env header').toBe(true);
      },
    },

    {
      name: 'a shipped block strips only in the file type that shipped it',
      run: (ctx) => {
        const env = `${DEFAULT_MARKER}\n# KNOWN=\n\n${CUSTOM_MARKER}\n# ...\n`;
        ctx.expect(mergeLineBasedFiles(env, `${DEFAULT_MARKER}\n# KNOWN=\n\n${CUSTOM_MARKER}\n`, '.env'), 'a .env never shipped `# ...`').toBe(env);

        const gitignore = `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n<!-- Add your project-specific notes below this line -->\n`;
        ctx.expect(mergeLineBasedFiles(gitignore, `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n`, '.gitignore'), 'the AGENTS.md block is not a .gitignore one').toBe(gitignore);

        const md = sectionMarkers('AGENTS.md');
        const agents = `${md.defaultMarker}\n@x\n\n${md.customMarker}\n# ...\n`;
        ctx.expect(mergeLineBasedFiles(agents, `${md.defaultMarker}\n@x\n\n${md.customMarker}\n`, 'AGENTS.md'), 'nor is `# ...` an AGENTS.md one').toBe(agents);
      },
    },
  ],
});
