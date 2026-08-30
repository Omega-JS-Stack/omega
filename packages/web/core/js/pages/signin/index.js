// Libraries
import authPages from '__main_assets__/js/libs/auth/index.js';
import omega from '@omega.js/client';
import { WAKEUP_ROUTE } from '@omega.js/client/modules/request.js';

// Module
export default () => {
  return new Promise(async function (resolve, reject) {
    // Warm the backend the moment the page loads: a first-time OAuth signin
    // creates the account right here, and the `/omega/user/signup` POST the
    // global auth listener fires behind it lands on the same cold function the
    // signup page pays for (Ian 2026-08-27). Fire-and-forget and
    // unauthenticated — the backend answers a wakeup before it loads a route or
    // authenticates ([#644](https://github.com/Omega-JS-Stack/omega/issues/644)).
    omega.request(WAKEUP_ROUTE, { wakeup: true });

    await authPages();

    // Resolve
    return resolve();
  });
}
