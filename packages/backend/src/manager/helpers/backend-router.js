/**
 * BackendRouter
 * Resolves an incoming request's URL to a RESTful route path for the
 * middleware system (e.g. /omega/user/sign-up → user/sign-up).
 */

function BackendRouter(Manager, req, res) {
  const self = this;

  self.Manager = Manager;
  self.req = req;
  self.res = res;
}

BackendRouter.prototype.resolve = function () {
  const self = this;
  const req = self.req;

  // Extract URL path
  const urlPath = req.path || '';

  // Strip prefix: /omega/, /omega_api/ (direct function URL), the legacy
  // /backend-manager/ alias (kept so migrating brands' in-the-wild clients
  // keep working), or leading slash.
  // The prefix must be a WHOLE first segment — longest alternative first, and
  // a boundary (slash or end of path) after it — so /omega_api/… is never
  // eaten by `omega` and /omegatron/… is not a prefixed path at all.
  const routePath = urlPath
    .replace(/^\/(omega_api|backend-manager|omega)(\/|$)/, '')
    .replace(/^\//, '');

  return {
    routePath: routePath,
  };
};

module.exports = BackendRouter;
