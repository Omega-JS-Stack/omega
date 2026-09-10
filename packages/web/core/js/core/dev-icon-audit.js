// Dev icon audit (development only; main.js only imports this chunk when
// omega.isDevelopment()). The build's inlining pass marks every icon the set
// had no file for with data-omega-icon-missing="<style>/<name>" (#619, web
// src/inline-icons.js) and leaves it EMPTY — this scan turns those silent
// gaps into console errors you can't miss, and re-checks once after load for
// late-rendered markup. Its runtime twin is the transport's own dev error
// (runtime/icons.js), which covers icons JS created after the build.
import { createLogger } from '__main_assets__/js/libs/logger.js';

/* @dev-only:start */
// Inside the block so production strips the import with the registration below
// (#342): main.js only calls this module in development, but esbuild resolves
// the dynamic import either way, so the chunk itself always gets emitted.
import { registerDevSection } from '__main_assets__/js/core/dev-sections.js';
/* @dev-only:end */

const logger = createLogger('dev-icon-audit');


/**
 * Scan the DOM for tagged fallback icons and console.error each distinct
 * miss once.
 */
export default function devIconAudit() {
  const reported = new Set();

  const scan = () => {
    document.querySelectorAll('[data-omega-icon-missing]').forEach((el) => {
      const slug = el.getAttribute('data-omega-icon-missing');
      const key = `${slug}`;
      if (reported.has(key)) return;
      reported.add(key);
      logger.error(`Missing icon "${slug}" — the icon set has no file for it`, el);
    });
  };

  scan();
  // One delayed pass for markup that lands after boot (bindings, lazy HTML)
  setTimeout(scan, 2500);

  /* @dev-only:start */
  // Re-scan on demand from the palette (#342), so the audit is a thing you can
  // FIND rather than only a console line that scrolled past. The rescan clears
  // the once-per-slug memory: after fixing an icon you want to hear about the
  // ones still missing, and after new markup lands you want the full picture.
  registerDevSection('icons', {
    title: 'Icons',
    buildNode: (doc) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'omega-devbar__btn';
      button.textContent = 'Re-run icon audit';
      button.addEventListener('click', () => {
        reported.clear();
        scan();
        logger.log('Icon audit re-run');
      });

      return button;
    },
  });
  /* @dev-only:end */
}
