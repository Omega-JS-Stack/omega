// The extension's own lifecycle event ([#328](https://github.com/Omega-JS-Stack/omega/issues/328)
// inventory gap 7: the extension counted nothing about ITSELF — the only signal
// anywhere was `extension_install`, fired by the website's landing page).
//
// `app_launch` is the catalog's launch event, the same one desktop's main
// process fires. Every context that boots @omega.js/client is a launch of a
// surface — the toolbar popup, the side panel, the options page, an injected
// page — and each carries its own session, so each counts one.
//
// Install tracking stays where it is: the web landing page owns
// `extension_install`, deliberately (it is the page that knows a store visit
// turned into an install).
import omega from '@omega.js/client';

/**
 * Count this context's launch. Never throws at a boot: analytics is a side
 * effect of the surface opening, not a condition of it.
 * @returns {void}
 */
export function trackAppLaunch() {
  try {
    omega.analytics().event('app_launch');
  } catch (e) {
    // The client logs its own failures; a launch is not the place to raise.
  }
}
