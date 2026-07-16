/**
 * The default service-worker entry — used when the consumer has no
 * src/service-worker.js of its own. The scaffolded consumer file starts as
 * an exact copy of this; custom SW code goes there.
 */
import Manager from '@omega.js/web/service-worker';

// Load Manager
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  // Log
  console.log('Initialized service-worker.js');

  // Custom code
  // ...
});
