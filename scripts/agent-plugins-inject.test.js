/**
 * The inject hook: a project's framework dependencies, and a brand's declared
 * targets, ask the session for the matching omega skills.
 * Run: node --test scripts/agent-plugins-inject.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('fs');
const path = require('path');

const { project, inject, brand, doneWhenBrand } = require('./agent-plugins-fixtures');

module.exports = defineCases({
  type: 'group',
  description: 'agent-plugins-inject',
  tests: [
    {
      name: 'inject: every framework dependency asks for its skill',
      run: (ctx) => {
        const table = {
          '@omega.js/web': 'omega:web',
          '@omega.js/backend': 'omega:backend',
          '@omega.js/desktop': 'omega:desktop',
          '@omega.js/extension': 'omega:extension',
          '@omega.js/manager': 'omega:manager',
        };

        for (const [pkg, skill] of Object.entries(table)) {
          const dir = project({ name: 'a-brand', dependencies: { [pkg]: '^1.0.0' } });
          const out = inject(dir);
          ctx.expect(out, `${pkg} did not inject ${skill}`).toMatch(new RegExp(skill));
          ctx.expect(JSON.parse(out).hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'inject: a devDependency counts too',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', devDependencies: { '@omega.js/backend': '^1.0.0' } });
        ctx.expect(inject(dir)).toMatch(/omega:backend/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: depending on @omega.js/client is silent — the runtime is embedded everywhere',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', dependencies: { '@omega.js/client': '^1.0.0' } });
        ctx.expect(inject(dir)).toBe('');
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: being @omega.js/client asks for omega:client',
      run: (ctx) => {
        const dir = project({ name: '@omega.js/client', version: '1.0.0' });
        ctx.expect(inject(dir)).toMatch(/omega:client/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: being a framework package asks for its own skill',
      run: (ctx) => {
        const dir = project({ name: '@omega.js/web', version: '1.0.0' });
        ctx.expect(inject(dir)).toMatch(/omega:web/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: the monorepo root asks for omega:main',
      run: (ctx) => {
        const dir = project({ name: 'omega', version: '1.0.0' });
        ctx.expect(inject(dir)).toMatch(/omega:main/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: a backend target with @omega.js/backend only in functions/ still matches',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', version: '1.0.0' });
        fs.mkdirSync(path.join(dir, 'functions'));
        fs.writeFileSync(
          path.join(dir, 'functions', 'package.json'),
          JSON.stringify({ name: 'a-brand-functions', dependencies: { '@omega.js/backend': '^1.0.0' } }),
        );
        ctx.expect(inject(dir)).toMatch(/omega:backend/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: two frameworks ask for both skills in one message',
      run: (ctx) => {
        const dir = project({
          name: 'a-brand',
          dependencies: { '@omega.js/web': '^1.0.0', '@omega.js/desktop': '^1.0.0' },
        });
        const out = inject(dir);
        const context = JSON.parse(out).hookSpecificOutput.additionalContext;
        ctx.expect(context).toMatch(/invoke these skills/);
        ctx.expect(context).toMatch(/omega:desktop, omega:web/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: no package.json is silent',
      run: (ctx) => {
        const dir = project(null);
        ctx.expect(inject(dir)).toBe('');
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: malformed package.json is silent',
      run: (ctx) => {
        const dir = project('{ this is not json');
        ctx.expect(inject(dir)).toBe('');
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: the same session is asked once',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', dependencies: { '@omega.js/desktop': '^1.0.0' } });
        const session = `repeat-${Date.now()}-${Math.random()}`;
        ctx.expect(inject(dir, session)).toMatch(/omega:desktop/);
        ctx.expect(inject(dir, session)).toBe('');
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    // --- the inject hook: brand-level discovery ---

    {
      name: 'inject: a brand root asks for main, manager, and one skill per target',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const context = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
        for (const skill of ['omega:main', 'omega:manager', 'omega:web', 'omega:backend']) {
          ctx.expect(context, `the brand root did not ask for ${skill}`).toMatch(new RegExp(skill));
        }
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: a brand injection names the framework map as required reading',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const context = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
        ctx.expect(context).toMatch(/node_modules\/@omega\.js\/manager\/AGENTS\.md/);
        ctx.expect(context, 'the pointer is required reading BEFORE the first edit').toMatch(/before/i);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: a target directory the config never names still asks for its skill',
      run: (ctx) => {
        const dir = brand({
          config: "{\n  targets: {\n    web: { type: 'web' },\n  },\n}\n",
          targets: { app: { name: 'a-brand-app', devDependencies: { '@omega.js/desktop': '^1.0.0' } } },
        });
        ctx.expect(inject(dir)).toMatch(/omega:desktop/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: a target declared in config with no directory yet still asks for its skill',
      run: (ctx) => {
        const dir = brand({ config: "{\n  targets: {\n    extension: { type: 'extension' },\n  },\n}\n" });
        ctx.expect(inject(dir)).toMatch(/omega:extension/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    // The KEY is a NAME, so the entry's `type` is the only thing that can
    // say which framework runs there: a brand that calls its extension `addon`
    // asks for omega:extension exactly like one that calls it `extension`.
    {
      name: 'inject: a target the brand NAMED itself asks by its declared type (#886)',
      run: (ctx) => {
        const dir = brand({ config: "{\n  targets: {\n    addon: { type: 'extension' },\n    storefront: { type: 'web' },\n  },\n}\n" });
        const context = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
        ctx.expect(context).toMatch(/omega:extension/);
        ctx.expect(context).toMatch(/omega:web/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: a backend target with its framework only in functions/ still matches',
      run: (ctx) => {
        const dir = brand({ config: '{}', targets: { backend: { name: 'a-brand-backend' } } });
        fs.mkdirSync(path.join(dir, 'targets', 'backend', 'functions'));
        fs.writeFileSync(
          path.join(dir, 'targets', 'backend', 'functions', 'package.json'),
          JSON.stringify({ name: 'fns', dependencies: { '@omega.js/backend': '^1.0.0' } }),
        );
        ctx.expect(inject(dir)).toMatch(/omega:backend/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: a custom target maps to nothing',
      run: (ctx) => {
        const dir = brand({
          config: "{\n  targets: {\n    api: { type: 'custom' },\n  },\n}\n",
          targets: { api: { name: 'a-brand-api', dependencies: { express: '^4.0.0' } } },
        });
        const context = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
        ctx.expect(context).toMatch(/omega:manager/);
        for (const skill of ['omega:web', 'omega:backend', 'omega:desktop', 'omega:extension']) {
          ctx.expect(context, `the custom target asked for ${skill}`).not.toMatch(new RegExp(skill));
        }
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: an unreadable config still yields the brand set from the manifests',
      run: (ctx) => {
        const dir = brand({ config: '{ this is not json5 at all', targets: { web: { name: 'w', dependencies: { '@omega.js/web': '^1.0.0' } } } });
        const context = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
        ctx.expect(context).toMatch(/omega:web/);
        ctx.expect(context).toMatch(/omega:main/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: a target that appears mid-session re-triggers its own line only',
      run: (ctx) => {
        const dir = brand({ config: '{}', targets: { web: { name: 'w', dependencies: { '@omega.js/web': '^1.0.0' } } } });
        const session = `grow-${process.pid}-${Date.now()}`;
        ctx.expect(inject(dir, session)).toMatch(/omega:web/);

        fs.mkdirSync(path.join(dir, 'targets', 'app'));
        fs.writeFileSync(
          path.join(dir, 'targets', 'app', 'package.json'),
          JSON.stringify({ name: 'a', dependencies: { '@omega.js/desktop': '^1.0.0' } }),
        );

        const context = JSON.parse(inject(dir, session)).hookSpecificOutput.additionalContext;
        ctx.expect(context, 'the new target never asked for its skill').toMatch(/omega:desktop/);
        ctx.expect(context, 'the already-asked skill was asked again').not.toMatch(/omega:web/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'inject: a plain project is still not a brand',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
        const context = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
        ctx.expect(context).not.toMatch(/omega:main/);
        ctx.expect(context).not.toMatch(/AGENTS\.md/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },
  ],
});
