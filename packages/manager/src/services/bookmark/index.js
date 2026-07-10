/**
 * Bookmark service — pushes the brand's console/dashboard bookmarks to
 * the companion Chrome extension (extension/) over the WebSocket
 * protocol; the extension files them under Ω / {Brand} / {Category}.
 *
 * The links are derived from the brand's own config + state (new-world
 * shapes: the single brand monorepo repo instead of omega-manager's
 * per-target repos, unslugged Stripe dashboard URLs instead of the
 * ITW platform-account deep links). The sync itself is interactive-only:
 * it needs a running Chrome with the extension connected, so headless
 * runs skip cleanly instead of sitting in the connect wait.
 */
const { createServiceRunner } = require('../../lib/service-runner.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
});
