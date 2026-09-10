// Build-layer pin for setupGlobalHandlers(): it is called BARE at top level
// (before any Manager exists) so that MV3 registers the SW listeners before any
// async work. In an ES module `this` is undefined there, so every `this.<x>`
// inside that function is a TypeError the moment its listener fires — which is
// exactly what broke the fresh-install welcome tab ([#90]): the install logger
// was read off `this`.
//
// background.js is a browser-context ES module (top-level importScripts +
// firebase imports), so node cannot import it — this pins the SOURCE, like
// cache-warming.test.js does. The whole class of bug is covered, not just the
// two lines that regressed: NOTHING inside the function body may touch `this`.

const fs = require('fs');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'background.js'), 'utf8');

// The body of `function setupGlobalHandlers() { … }`, by brace matching.
function globalHandlersBody() {
  const start = SOURCE.indexOf('function setupGlobalHandlers() {');
  if (start === -1) { return null; }
  let depth = 0;
  for (let i = SOURCE.indexOf('{', start); i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') { depth++; }
    if (SOURCE[i] === '}') {
      depth--;
      if (depth === 0) { return SOURCE.slice(start, i + 1); }
    }
  }
  return null;
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'background.js setupGlobalHandlers — no `this` in a bare-called function (#90)',
  tests: [
    {
      name: 'it is called bare at top level, before the Manager class',
      run: (ctx) => {
        ctx.expect(SOURCE).toMatch(/^setupGlobalHandlers\(\);$/m);
        ctx.expect(SOURCE.indexOf('setupGlobalHandlers();')).toBeLessThan(SOURCE.indexOf('class Manager'));
      },
    },
    {
      name: 'its body never references `this` — every listener there would throw',
      run: (ctx) => {
        const body = globalHandlersBody();
        ctx.expect(typeof body).toBe('string');
        const offenders = (body.match(/\bthis\s*[.[]/g) || []);
        ctx.expect(offenders.length).toBe(0);
      },
    },
    {
      name: 'the install listener logs through the module-level installLogger',
      run: (ctx) => {
        // Module scope, not an instance property
        ctx.expect(SOURCE).toMatch(/^const installLogger = new LoggerLite\('install'\);$/m);
        ctx.expect(/this\.installLogger/.test(SOURCE)).toBe(false);

        const body = globalHandlersBody();
        // Both fresh-install lines, and the tab open they guard
        ctx.expect(body).toMatch(/installLogger\.log\('No website configured, skipping install page'\)/);
        ctx.expect(body).toMatch(/installLogger\.log\('Opening install page:', installedUrl\)/);
        ctx.expect(body).toMatch(/extension\.tabs\.create\(\{ url: installedUrl \}\)/);
      },
    },
  ],
});
