/**
 * Test: no request options object ever combines `log: true` with a secret header
 * ([#702](https://github.com/Omega-JS-Stack/omega/issues/702)).
 *
 * `wonderful-fetch` prints its WHOLE configuration — headers included — when a
 * caller passes `log: true`, so an options object carrying both a credential
 * header and that flag writes the live credential into Cloud Logging on every
 * call. The discord/spotify providers already carry the NO-`log: true` comment
 * for exactly this reason; this is the guard that keeps the idiom from rotting.
 *
 * The scan is a source read, not a callee resolution: ANY options object that
 * pairs `log: true` with a secret-shaped header key is a leak whatever library
 * consumes it, so the check does not care which function is being called. Full-
 * line comments are blanked first (an idle `// log: true` is inert), preserving
 * byte offsets so reported line numbers stay true.
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const SOURCE_DIRS = [
  path.join(__dirname, '../../dist/manager'),
  path.join(__dirname, '../../dist/mcp'),
];

// `log: true` anywhere in an options object.
const LOG_FLAG = /\blog\s*:\s*true\b/g;

// A key that carries a credential: the middleware's CREDENTIAL_HEADERS set
// (authorization, omega-admin-key, cookie — src/manager/helpers/middleware.js),
// an api key, or any dash/underscore `*-key` / `*-token` / `*-secret` key (the
// snake_case form covers body fields like `client_secret` — `log: true` dumps
// the whole config, body included). Requires the trailing `:` so a VALUE like
// `grant_type: 'authorization_code'` and a dashless field like `pageToken`
// never match.
const SECRET_KEY = /['"]?(?:omega-admin-key|authorization|cookie|api[-_]?key|[a-z0-9]+(?:[-_][a-z0-9]+)*[-_](?:key|token|secret))['"]?\s*:/i;

/**
 * Blank every full-line comment, keeping the file's length and line count
 * identical so offsets and line numbers still line up with the real source.
 */
function blankComments(source) {
  let inBlock = false;

  return source.split('\n').map((line) => {
    const trimmed = line.trim();
    const opensBlock = trimmed.startsWith('/*');
    const isComment = inBlock || opensBlock || trimmed.startsWith('//') || trimmed.startsWith('*');

    if (opensBlock && !trimmed.includes('*/')) { inBlock = true; }
    if (inBlock && trimmed.includes('*/')) { inBlock = false; }

    return isComment ? ' '.repeat(line.length) : line;
  }).join('\n');
}

/**
 * The innermost object literal enclosing `index`, as a [start, end] span.
 * Walks back to the unmatched `{`, then forward to its partner.
 */
function enclosingObject(source, index) {
  let depth = 0;
  let start = -1;

  for (let i = index; i >= 0; i--) {
    if (source[i] === '}') { depth++; }
    if (source[i] === '{') {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }

  if (start === -1) { return null; }

  depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') { depth++; }
    if (source[i] === '}') {
      depth--;
      if (depth === 0) { return source.slice(start, i + 1); }
    }
  }

  return null;
}

module.exports = defineCases({
  description: 'No options object logs a secret header (#702)',
  type: 'group',
  timeout: 10000,

  tests: [
    {
      name: 'no-log-true-alongside-a-secret-header',
      auth: 'none',

      async run({ assert }) {
        const offenders = [];

        for (const dir of SOURCE_DIRS) {
          for (const file of jetpack.find(dir, { matching: '*.js' })) {
            const source = blankComments(jetpack.read(file) || '');

            for (const match of source.matchAll(LOG_FLAG)) {
              const options = enclosingObject(source, match.index);
              const secret = options && SECRET_KEY.exec(options);

              if (!secret) { continue; }

              // The header NAME only — never the source line, which is where a
              // value would live.
              const line = source.slice(0, match.index).split('\n').length;
              offenders.push(`${path.relative(path.join(__dirname, '../..'), file)}:${line} (header "${secret[0].replace(/['":\s]/g, '')}")`);
            }
          }
        }

        if (offenders.length > 0) {
          assert.fail(`Options object logs a secret header — drop \`log: true\`: ${offenders.join(', ')}`);
        }
      },
    },
  ],
});
