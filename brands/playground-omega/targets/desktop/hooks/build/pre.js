// Optional consumer extension hook — called BEFORE the build pipeline runs (defaults →
// distribute → bundle → sass → html → audit → build-config). No-op by default.
//
// Use this for: pre-flight checks, generating build-time artifacts, mutating config before
// the bundle / build-config tasks see it.

module.exports = async (ctx) => {
  // ctx = { manager, mode, projectRoot }
};
