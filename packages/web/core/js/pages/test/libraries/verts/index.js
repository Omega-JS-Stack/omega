/**
 * Vert test page JavaScript
 *
 * Page-local QA affordance only: a Reload button under every demo slot that
 * tears the mounted unit down and re-mounts it through the public verts API,
 * so the house lane re-rolls its weighted-random pick server-side (the serve
 * URL is cache-busted per impression) and the ladder runs again from the top.
 * Nothing here is framework surface — a real page never carries it.
 */

// Libraries
import omega from '@omega.js/client';
import { createLogger } from '__main_assets__/js/libs/logger.js';

const logger = createLogger('test:verts');

// Module
export default () => {
  return new Promise(async function (resolve) {
    await omega.dom().ready();

    document.querySelectorAll('.omega-vert-unit').forEach(($host) => {
      addReloadButton($host);
    });

    return resolve();
  });
};

/**
 * Add one slot's Reload control below its unit.
 * @param {Element} $host - the .omega-vert-unit element
 */
function addReloadButton($host) {
  const $row = document.createElement('div');
  $row.className = 'd-flex justify-content-end mt-2';

  const $button = document.createElement('button');
  $button.type = 'button';
  $button.className = 'btn btn-sm btn-outline-secondary';
  $button.textContent = 'Reload';
  $button.addEventListener('click', () => reloadUnit($host));

  $row.appendChild($button);
  $host.parentNode.appendChild($row);
}

/**
 * Tear the slot's unit down and re-mount it: destroy the live unit (its
 * message listeners and timers outlive the DOM otherwise), empty the host,
 * clear the mount latch, then hand the element back to the module.
 * @param {Element} $host - the .omega-vert-unit element
 */
function reloadUnit($host) {
  const unit = $host.__omegaVertUnit;

  if (unit && typeof unit.destroy === 'function') {
    unit.destroy();
  }

  $host.replaceChildren();
  $host.__omegaVertUnit = null;
  $host.__omegaVertMounted = false;

  omega.verts().mount($host);

  logger.log('slot re-mounted', $host.getAttribute('data-omega-vert-size') || 'unsized');
}
