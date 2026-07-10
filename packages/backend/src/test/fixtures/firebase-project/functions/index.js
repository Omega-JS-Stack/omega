/*
  @omega.js/backend self-test fixture — a minimal consumer backend used ONLY when the framework
  tests itself (`npx omega test` run from the @omega.js/backend repo). The runner points
  BEM_TEST_BOOT_PROJECT here and symlinks the local @omega.js/backend into
  functions/node_modules so the emulator's function workers resolve it.

  Mirrors a real consumer's functions/index.js: one-line @omega.js/backend bootstrap.
*/
const Manager = (new (require('@omega.js/backend'))).init(exports, {});
const { functions } = Manager.libraries;
