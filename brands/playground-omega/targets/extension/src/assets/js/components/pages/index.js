/**
 * Surface: a custom extension page (a page context), the notes dashboard
 * Doc: node_modules/@omega.js/extension/docs/components.md
 *
 * The sidepanel's list (../../lib/notes-list.js), plus omega.auth.reload()
 * after each create: the one re-read of the account, beside the listen() the
 * list already runs on.
 */
import omega from '@omega.js/extension/page';
import { mountNotes } from '../../lib/notes-list.js';

omega.initialize()
  .then(() => {
    mountNotes({ omega, onCreated: () => omega.auth.reload() });

    omega.logger.log('Notes page initialized!');
  });
