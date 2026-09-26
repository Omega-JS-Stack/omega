/**
 * The default service-worker entry — used when the consumer has no
 * src/service-worker.js of its own. The scaffolded consumer file starts as
 * an exact copy of this; custom SW code goes there.
 */
import omega from '@omega.js/web/service-worker';

// Initialize
omega.initialize()
.then(() => {
  // Log
  console.log('Initialized service-worker.js');

  // Custom code
  // ...
});
