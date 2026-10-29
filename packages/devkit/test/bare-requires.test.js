/**
 * bare-requires: the scan marks a consumer's undeclared require of a package
 * the framework declares, and the nudge prints one line per finding naming
 * both fixes: declare it, or load the framework's copy through the caller's
 * door. Never an error.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectBareRequires, nudgeBareRequires } = require('../src/bare-requires.js');

const DOOR = (name) => `omega.require('${name}')`;

/** A temp dir holding the given files, relative path to contents. */
function tree(prefix, files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  for (const [rel, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), contents);
  }
  return dir;
}

/** A framework root declaring fs-jetpack. */
function framework() {
  return tree('devkit-bare-framework-', {
    'package.json': JSON.stringify({ name: '@omega.js/fake', dependencies: { 'fs-jetpack': '^5.1.0' } }),
  });
}

/** A consumer project whose src/index.js holds `source`, its manifest declaring `dependencies`. */
function project(source, dependencies = {}) {
  return tree('devkit-bare-project-', {
    'package.json': JSON.stringify({ name: 'consumer', dependencies }),
    'src/index.js': source,
  });
}

module.exports = defineCases({
  type: 'group',
  description: 'bare-requires: the framework flag and the nudge',
  tests: [
    {
      name: 'an undeclared require of a framework-declared package is marked framework and names the door',
      run: async (ctx) => {
        const frameworkRoot = framework();
        const root = project("const jetpack = require('fs-jetpack');\n");

        const findings = collectBareRequires(root, { srcDir: 'src', frameworkRoot });
        ctx.expect(findings.length, 'one undeclared package, one finding').toBe(1);
        ctx.expect(findings[0].framework, 'the framework declares it').toBe(true);

        const lines = [];
        await nudgeBareRequires({ root, srcDir: 'src', frameworkRoot, door: DOOR, warn: (line) => lines.push(line) });
        ctx.expect(lines).toEqual([
          `${path.join('src', 'index.js')}:1: \`fs-jetpack\` is not declared in this project's package.json: declare it (\`npm install fs-jetpack\`), or load the framework's copy with omega.require('fs-jetpack')`,
        ]);
      },
    },

    {
      name: 'an undeclared require of a package the framework does not declare gets the declare-only text',
      run: async (ctx) => {
        const frameworkRoot = framework();
        const root = project("const pad = require('left-pad');\n");

        const findings = collectBareRequires(root, { srcDir: 'src', frameworkRoot });
        ctx.expect(findings.length).toBe(1);
        ctx.expect(findings[0].framework, 'not the framework\'s package').toBeFalsy();

        const lines = [];
        await nudgeBareRequires({ root, srcDir: 'src', frameworkRoot, door: DOOR, warn: (line) => lines.push(line) });
        ctx.expect(lines.length).toBe(1);
        ctx.expect(lines[0].startsWith(`${path.join('src', 'index.js')}:1: \`left-pad\``), lines[0]).toBe(true);
        ctx.expect(lines[0], 'the fix is to declare it').toMatch(/npm install left-pad/);
        ctx.expect(lines[0].includes('omega.require'), 'no framework copy to offer').toBe(false);
      },
    },

    {
      name: 'a declared package yields nothing, framework-declared or not',
      run: async (ctx) => {
        const frameworkRoot = framework();
        const root = project(
          "const jetpack = require('fs-jetpack');\nconst pad = require('left-pad');\n",
          { 'fs-jetpack': '^4.0.0', 'left-pad': '^1.3.0' },
        );

        ctx.expect(collectBareRequires(root, { srcDir: 'src', frameworkRoot }), 'a consumer-declared version always wins').toEqual([]);

        const lines = [];
        const findings = await nudgeBareRequires({ root, srcDir: 'src', frameworkRoot, door: DOOR, warn: (line) => lines.push(line) });
        ctx.expect(findings).toEqual([]);
        ctx.expect(lines).toEqual([]);
      },
    },

    {
      name: 'the nudge warns once per finding and returns the findings',
      run: async (ctx) => {
        const frameworkRoot = framework();
        const root = project("const jetpack = require('fs-jetpack');\nconst pad = require('left-pad');\n");

        const lines = [];
        const findings = await nudgeBareRequires({ root, srcDir: 'src', frameworkRoot, door: DOOR, warn: (line) => lines.push(line) });

        ctx.expect(findings.length, 'both undeclared packages').toBe(2);
        ctx.expect(lines.length, 'one warning line per finding').toBe(2);
        ctx.expect(findings.map((finding) => Boolean(finding.framework)).sort()).toEqual([false, true]);
        ctx.expect(lines.some((line) => line.includes("omega.require('fs-jetpack')"))).toBe(true);
        ctx.expect(lines.some((line) => line.includes('`left-pad`'))).toBe(true);
      },
    },

    {
      name: 'the nudge never throws: an empty project warns nothing and returns no findings',
      run: async (ctx) => {
        const frameworkRoot = framework();
        const root = tree('devkit-bare-empty-', {});

        const lines = [];
        const findings = await nudgeBareRequires({ root, srcDir: 'src', frameworkRoot, door: DOOR, warn: (line) => lines.push(line) });

        ctx.expect(findings).toEqual([]);
        ctx.expect(lines).toEqual([]);
      },
    },
  ],
});
