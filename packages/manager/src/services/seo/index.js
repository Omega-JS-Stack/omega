/**
 * SEO service — parasite SEO content: programmatically created GitHub
 * repos with templated READMEs, download scripts, and a maintenance
 * workflow, defined per brand under seo.github.content[].
 *
 * Content lives in config/omega.json5 (`seo.github.content`) or the
 * config/seo.json5 sidecar (the chatsy.md/replyify.md convention — big
 * content sections in their own file; the sidecar's keys merge over the
 * config's seo section). omega-manager kept the sidecar at
 * .brands/{id}/seo.json and auto-created a default entry for every brand
 * — the port never writes config (auto-creating entries is a parked onboarding follow-up); no
 * content → clean skip.
 *
 * Auth: the default `gh` CLI auth, with per-item author overrides
 * (author.token `env:VAR` + author.git identity) for parasite repos owned
 * by separate accounts.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');

const { createServiceRunner } = require('../../lib/service-runner.js');
const ghApi = require('./lib/gh-api.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: (context) => {
    const config = context.brandConfig.seo;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'seo.enabled = false' };
    }

    // Sidecar keys merge over the config's seo section (omega-manager parity)
    let seo = config || {};
    const sidecarPath = join(context.brandRoot, 'config', 'seo.json5');
    if (jetpack.exists(sidecarPath)) {
      seo = { ...seo, ...JSON5.parse(jetpack.read(sidecarPath)) };
    }

    if (!seo.github?.content?.length) {
      return { skip: true, reason: 'no SEO content configured (add seo.github.content to config/omega.json5 or a config/seo.json5 sidecar)' };
    }

    // Tests inject a fake API via context.seoApi; the real path needs gh
    // installed + authenticated before any item work starts
    let seoApi = context.seoApi;
    if (!seoApi) {
      ghApi.verifyGhCli();
      seoApi = ghApi;
    }

    return { seoApi, seoContent: seo.github.content };
  },
});
