// The extension's own lifecycle event ([#328](https://github.com/Omega-JS-Stack/omega/issues/328)
// inventory gap 7: the extension counted nothing about ITSELF; the only signal
// anywhere was `extension_install`, fired by the website's landing page).
//
// `app_launch` is the catalog's launch event, the same one desktop's main
// process fires. The toolbar popup, the side panel and an injected page are
// launches of a surface, and each carries its own session, so each counts one.
//
// Install tracking stays where it is: the web landing page owns
// `extension_install`, deliberately (it is the page that knows a store visit
// turned into an install).

// The page contexts that count as a launch. The OPTIONS page is not one:
// opening settings is not launching the extension, and counting it would
// inflate the launch count with a maintenance visit (Ian's ruling).
export const LAUNCH_CONTEXTS = ['popup', 'sidepanel', 'page'];

/**
 * Count this context's launch, when it is a launch context. Never throws at a
 * boot: analytics is a side effect of the surface opening, not a condition of it.
 * @param {object} omega - the page context's Omega instance
 * @returns {void}
 */
export function trackAppLaunch(omega) {
  if (!LAUNCH_CONTEXTS.includes(omega.context)) {
    return;
  }

  try {
    omega.analytics.event('app_launch');
  } catch (e) {
    // The client logs its own failures; a launch is not the place to raise.
  }
}
