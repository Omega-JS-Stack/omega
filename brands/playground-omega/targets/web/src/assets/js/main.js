/**
 * Surface: the site-wide module, EXTENDING the framework's instead of replacing it
 * Doc: node_modules/@omega.js/web/docs/index.md (Key contracts: the extend lane)
 */
import coreMain from 'omega:main';

export default async (context) => {
  await coreMain(context);

  document.documentElement.setAttribute('data-omega-notes', 'ready');
  console.log('[playground] site-wide module extended: the notes demo lives at /notes');
};
