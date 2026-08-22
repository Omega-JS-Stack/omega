/*
  @omega.js/backend self-test fixture — a minimal consumer backend used ONLY when the framework
  tests itself (`npx omega test` run from the @omega.js/backend repo). The runner points
  OMEGA_TEST_BOOT_PROJECT here and symlinks the local @omega.js/backend into the target-root
  node_modules; the emulator's function workers resolve UP from the staged
  functions/ tree (src/dist pillar — this src/ is the authored code).

  Mirrors a real consumer's src/index.js: one-line @omega.js/backend bootstrap.
*/
const Manager = (new (require('@omega.js/backend'))).init(exports, {});
const { functions } = Manager.libraries;
