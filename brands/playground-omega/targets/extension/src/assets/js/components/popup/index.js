/**
 * Surface: the popup (a page context)
 * Doc: node_modules/@omega.js/extension/docs/contexts.md
 *
 * What it consumes, one of each: data-omega-bind for the signed-in state and
 * the count (omega.bindings), the .omega-signin / .omega-signout classes (no
 * JS), omega.messenger.send to background for the count, omega.storage (the
 * page store) to paint the last count before background answers, and
 * omega.extension.tabs to open the pages dashboard.
 */
import omega from '@omega.js/extension/popup';
import { askBackground } from '../../lib/notes.js';

const COUNT_KEY = 'notes.count';

omega.initialize()
  .then(async () => {
    const { extension, bindings, storage, logger } = omega;

    // The last count this popup saw, painted at once: background may have to
    // list the notes before it can answer
    bindings.update({ notes: { count: storage.get(COUNT_KEY, 0) } });

    document.getElementById('open-notes').addEventListener('click', () => {
      extension.tabs.create({ url: extension.runtime.getURL('views/pages/index.html') });
    });

    const { count } = await askBackground(omega, 'notes:count');

    storage.set(COUNT_KEY, count);
    bindings.update({ notes: { count } });

    logger.log('Popup initialized!');
  })
  .catch((error) => omega.utilities.showNotification(error.message, { type: 'danger' }));
