// `npx omega cdp <subcommand>` — drive the RUNNING dev app over the Chrome
// DevTools Protocol: orient (status), act (eval, theme), see (shot, capture),
// and run the no-watch iterate loop (relaunch / quit).
//
//   npx omega cdp status                          # running? targets, window rect, theme
//   npx omega cdp eval <match> '<expr>'           # evaluate JS in any webContents
//   npx omega cdp shot <match> <out.png>          # ONE renderer's own pixels
//   npx omega cdp capture <out.png>               # the COMPOSITED window (macOS)
//   npx omega cdp theme <dark|light|system>       # flip the live theme
//   npx omega cdp relaunch                        # quit → npm start → wait for boot
//   npx omega cdp quit                            # quit + wait for the process tree to drain
//
// All subcommands read OMEGA_CDP_PORT (default 9222) — the same env var `npm
// start` uses to open the endpoint — or take `--port <n>` (which wins).
// `--port` exists for npm scripts: prefixing `npx cross-env OMEGA_CDP_PORT=…`
// MANGLES quoted eval expressions (cross-env strips inner quotes), so a
// pinned-port script must pass the port as a flag instead. Targets are
// matched by URL substring (the main window is always `/views/main/`).
// Full reference: docs/cdp-debugging.md.

const path = require('path');

const SUBCOMMANDS = ['status', 'eval', 'shot', 'capture', 'theme', 'relaunch', 'quit'];

const USAGE = [
  'Usage: npx omega cdp <subcommand> [--port <n>]   (port default: OMEGA_CDP_PORT or 9222)',
  '  status                       app up? targets, window rect, theme',
  "  eval <match> '<expr>'        evaluate JS in the matched webContents",
  '  shot <match> <out.png>       per-renderer screenshot',
  '  capture <out.png>            composited window capture (macOS)',
  '  theme <dark|light|system>    flip the live theme',
  '  relaunch                     quit → npm start → wait for boot',
  '  quit                         quit the app, wait for processes to drain',
].join('\n');

module.exports = async function (options) {
  options = options || {};
  options._ = options._ || [];

  const sub = options._[1];
  if (!sub || !SUBCOMMANDS.includes(sub)) {
    console.error(USAGE);
    throw new Error(sub ? `Unknown cdp subcommand "${sub}"` : 'Missing cdp subcommand');
  }

  // --port overrides OMEGA_CDP_PORT for this invocation (client.js reads the env).
  if (options.port) {
    process.env.OMEGA_CDP_PORT = String(options.port);
  }

  const handler = require(path.join(__dirname, 'cdp', `${sub}.js`));
  await handler(options);
};
