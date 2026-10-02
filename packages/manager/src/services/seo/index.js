/**
 * SEO service: parasite SEO content, programmatically created GitHub repos
 * with templated READMEs, download scripts, and a maintenance workflow.
 *
 * Content (seo.github.content[]) lives in
 * config/omega.json5 or the config/seo.json5 sidecar, which the config loader
 * reads as the `seo` section (merged and checked like the base file), so this
 * service reads `brandConfig.seo`, never opens a file, never writes config:
 * no content is a clean skip. Auth is the default `gh` CLI auth, with per-item
 * author overrides (`author.tokenEnv`, `author.git`) for separate accounts.
 */
const { createServiceRunner } = require('../../lib/service-runner.js');
const ghApi = require('./lib/gh-api.js');
const { ghGate } = require('../../lib/gh-gate.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: (context) => {
    const seo = context.brandConfig.seo;

    if (seo === false || seo?.enabled === false) {
      return { skip: true, reason: 'seo.enabled = false' };
    }

    if (!seo?.github?.content?.length) {
      return { skip: true, reason: 'no SEO content configured (add seo.github.content to config/omega.json5 or a config/seo.json5 sidecar)' };
    }

    // Tests inject a fake API via context.seoApi; the real path needs gh
    // installed and signed in before any item work starts (a headless walk
    // skips a signed-out gh)
    let seoApi = context.seoApi;
    if (!seoApi) {
      const skip = ghGate(context);
      if (skip) return skip;
      seoApi = ghApi;
    }

    return { seoApi, seoContent: seo.github.content };
  },
});
