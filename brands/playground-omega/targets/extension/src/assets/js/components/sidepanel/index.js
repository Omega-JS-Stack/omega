/**
 * Surface: the side panel (a page context)
 * Doc: node_modules/@omega.js/extension/docs/components.md
 *
 * The full notes list: list, create and delete, each a messenger round trip to
 * background, rendered with omega.utilities.escapeHTML (../../lib/notes-list.js).
 */
import omega from '@omega.js/extension/sidepanel';
import { mountNotes } from '../../lib/notes-list.js';

omega.initialize()
  .then(() => {
    mountNotes({ omega });

    omega.logger.log('Sidepanel initialized!');
  });
