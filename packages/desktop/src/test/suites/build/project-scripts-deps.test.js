// Build-layer test: every npx-invoked tool in the synced projectScripts must
// be a DECLARED peer dependency — an outside-the-monorepo consumer has no
// hoisted root to fall back on (cp194 wizard-rehearsal catch: `npx cross-env`
// in build/package/publish with cross-env undeclared → exit 127).

const path = require('path');

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

        ctx.expect(tools.has('cross-env')).toBe(true); // the script set genuinely uses it
        for (const tool of tools) {
          ctx.expect(Boolean(peers[tool])).toBe(true);
        }
      },
    },
  ],
};
