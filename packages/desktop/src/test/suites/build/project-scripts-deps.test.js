// Build-layer test: every npx-invoked tool in the synced projectScripts must
// be a DECLARED peer dependency — an outside-the-monorepo consumer has no
// hoisted root to fall back on (cp194 wizard-rehearsal catch: `npx cross-env`
// in build/package/publish with cross-env undeclared → exit 127).
//
// Since #117 the build-mode env flags are set in-process by the CLI verbs, so
// the scripts invoke nothing but `npx omega` — cross-env is gone from the
// scaffold, from desktop's own deps, and from the peer-dependency map.

const path = require('path');
const fs = require('fs');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'projectScripts — npx tools are declared peers',
  tests: [
    {
      name: 'every non-omega npx tool used by projectScripts is in peerDependencies',
      run: (ctx) => {
        const pkg = require(path.join(__dirname, '..', '..', '..', '..', 'package.json'));
        const peers = pkg.peerDependencies || {};

        const tools = new Set();
        for (const script of Object.values(pkg.projectScripts || {})) {
          for (const match of String(script).matchAll(/npx\s+([a-z0-9@/_-]+)/g)) {
            const tool = match[1];
            if (tool !== 'omega' && !tool.startsWith('@omega.js/')) {
              tools.add(tool);
            }
          }
        }

        for (const tool of tools) {
          ctx.expect(Boolean(peers[tool])).toBe(true);
        }
      },
    },
    {
      name: 'the build-mode env flags live in the CLI verbs, not in the scaffolded scripts',
      run: (ctx) => {
        const pkg = require(path.join(__dirname, '..', '..', '..', '..', 'package.json'));
        const scripts = pkg.projectScripts || {};

        for (const script of Object.values(scripts)) {
          ctx.expect(String(script).includes('cross-env')).toBe(false);
          ctx.expect(/OMEGA_BUILD_MODE|OMEGA_IS_PUBLISH/.test(String(script))).toBe(false);
        }

        ctx.expect(scripts.build).toBe('npx omega build');
        ctx.expect(scripts.package).toBe('npx omega package');
        ctx.expect(scripts['package:quick']).toBe('npx omega package --quick');
        ctx.expect(scripts.publish).toBe('npx omega publish');
        ctx.expect(scripts['release:local']).toBe('npx omega publish --local');
      },
    },
    {
      name: 'cross-env is not declared anywhere in @omega.js/desktop',
      run: (ctx) => {
        const pkg = require(path.join(__dirname, '..', '..', '..', '..', 'package.json'));

        ctx.expect(Boolean((pkg.dependencies || {})['cross-env'])).toBe(false);
        ctx.expect(Boolean((pkg.devDependencies || {})['cross-env'])).toBe(false);
        ctx.expect(Boolean((pkg.peerDependencies || {})['cross-env'])).toBe(false);
      },
    },
    {
      name: 'ensure-target no longer scaffolds cross-env into the consumer',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'lib', 'ensure-target.js'), 'utf8');
        ctx.expect(source.includes('cross-env')).toBe(false);
      },
    },
    {
      name: 'ensure-target syncs projectScripts unconditionally — consumers heal on the next verb',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'lib', 'ensure-target.js'), 'utf8');
        ctx.expect(/project\.scripts\[key\] = package\.projectScripts\[key\]/.test(source)).toBe(true);
      },
    },
  ],
};
