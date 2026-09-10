/**
 * Boot-layer test — the packaged extension can be messaged by YOUR site.
 *
 * `externally_connectable.matches` is baked at package time from `brand.url`
 * (plus the local dev origin in a dev build). A packaged build used to carry the
 * localhost dev origin alone, so the live brand site could not message the
 * published extension at all ([#583]). This asserts the real, built manifest of
 * the extension Chromium just loaded.
 *
 * Declaring `externally_connectable` in `src/manifest.json` is authoritative and
 * replaces the default outright — if you do that deliberately, edit this test to
 * match the origins you declared.
 */

module.exports = {
  layer: 'boot',
  description: 'the packaged manifest lets the brand site message the extension',
  inspect: async ({ extension, expect }) => {
    const Manager = new (require('@omega.js/extension/build'));
    const brandUrl = Manager.getConfig().brand?.url;

    // Nothing to assert until the brand declares its own site
    if (!brandUrl) return;

    const matches = extension.manifest.externally_connectable?.matches || [];
    expect(matches).toContain(`${new URL(brandUrl).origin}/*`);
  },
};
