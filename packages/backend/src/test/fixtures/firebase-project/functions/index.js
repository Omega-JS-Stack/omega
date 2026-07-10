/*
  @omegajs/backend self-test fixture — a minimal consumer backend used ONLY when the framework
  tests itself (`npx mgr test` run from the @omegajs/backend repo). The runner points
  BEM_TEST_BOOT_PROJECT here and symlinks the local @omegajs/backend into
  functions/node_modules so the emulator's function workers resolve it.

  Mirrors a real consumer's functions/index.js: one-line @omegajs/backend bootstrap.
*/
const Manager = (new (require('@omegajs/backend'))).init(exports, {});
const { functions } = Manager.libraries;
