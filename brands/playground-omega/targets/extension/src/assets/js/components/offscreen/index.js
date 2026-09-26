/**
 * Surface: the offscreen document (a light context background opens on demand)
 * Doc: node_modules/@omega.js/extension/docs/offscreen.md
 *
 * One handler, notes:parse: the plain text of an HTML string, through the
 * DOMParser a service worker does not have. Background calls it before every
 * notes:create.
 */
import omega from '@omega.js/extension/offscreen';

// Registered before initialize() settles: background sends the first
// notes:parse the moment createDocument resolves
omega.messenger.onMessage((message, _sender, sendResponse) => {
  if (message.command !== 'notes:parse') {
    return false;
  }

  const html = message.payload?.html || '';
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();

  sendResponse({ text });

  return false;
});

omega.initialize()
  .then(() => {
    omega.logger.log('Offscreen initialized!');
  });
