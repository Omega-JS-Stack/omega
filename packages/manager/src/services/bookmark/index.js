/**
 * Bookmark service — pushes the brand's console/dashboard bookmarks to
 * the OMEGA Companion extension over the WebSocket protocol; the extension
 * files them under Ω / {Brand} / {Category}. It is the OMEGA brand's own
 * extension target since #927: install it from the Chrome Web Store, or load
 * omega-omega/targets/extension/packaged/chrome/raw/ unpacked.
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
