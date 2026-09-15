/**
 * Disperse service: registered, with NO operations today
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
 *
 * It was the remnant of omega-manager's disperse after the config hierarchy
 * dissolved file dispersal (targets read config/omega.json5 directly, so there
 * is no .brands/ mirror and no per-repo config writes) and #678 dissolved the
 * .env composition. Its last operation copied signing artifacts into each
 * desktop target's certs dir, and that is gone too: the signing tree is READ IN
 * PLACE, company tier first, and the paths into it are derived once at the
 * desktop env load (`@omega.js/devkit/signing-env`). A copy meant two homes for
 * one fact, and the dispersed duplicate is what a build could silently sign
 * with after the tree had moved on.
 *
 * The SERVICE stays (Ian, 2026-09-12: "keep it in case we need to use it for
 * something legit"): it is the registered home for the next thing that
 * genuinely cannot ride the config hierarchy, and the walk prints it with
 * `no operations` until there is one.
 */
const { createServiceRunner } = require('../../lib/service-runner.js');

module.exports.run = createServiceRunner({ serviceDir: __dirname });
