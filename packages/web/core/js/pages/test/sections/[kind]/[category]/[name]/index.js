// Section gallery entry page (/test/sections/<kind>/<id>) — ONE job: autosize
// the embedded variant frames (#463), through the shared helper the component
// gallery uses too (#549).
// A wildcard entry serves the whole generated family (one page per resolved
// library entry). The page needs no JS to be usable: every variant renders
// stacked and the rail's links are plain anchor jumps (#540), and the inline
// min-height keeps an unmeasured frame usable (it scrolls instead of
// collapsing).

// Libraries
import omega from '@omega.js/client';
import autosizeShowcaseFrames from '__main_assets__/js/libs/showcase-frames.js';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await omega.dom().ready();

    autosizeShowcaseFrames();

    // Resolve after initialization
    return resolve();
  });
};
