// Libraries
import authPages from '__main_assets__/js/libs/auth/index.js';
import omega from '@omega.js/client';
import { WAKEUP_ROUTE } from '@omega.js/client/modules/request.js';

// Module
export default () => {
  return new Promise(async function (resolve, reject) {
    // Warm the backend the moment the page loads: the POST that ends this flow
    // (`/omega/user/signup`, fired by the global auth listener as soon as the
    // account exists) is the visitor's first real hit, and a cold function
    // turned it into a 14-second wait on the button (Ian 2026-08-27).
    // Fire-and-forget and unauthenticated — the backend answers a wakeup before
    // it loads a route or authenticates
    // ([#644](https://github.com/Omega-JS-Stack/omega/issues/644)).
    omega.request(WAKEUP_ROUTE, { wakeup: true });

    await authPages();

    // Resolve
    return resolve();
  });
}
