/**
 * tags/index.js — the registered-name => tag-definition map.
 *
 * Names match jekyll-uj-powertools' Liquid registrations exactly (including
 * the four unprefixed ones: iftruthy, iffalsy, iffile, urlmatches) so
 * templates port verbatim. Each definition is `{ block, render(ctx, markup
 * [, renderInner]) }`; the engine adapter (register-liquid.js) builds `ctx`.
 */

const { iftruthy, iffalsy, iffile, urlmatches } = require('./conditionals.js');
const { omegaReadtime, omegaFakeComments, omegaExternal, omegaSocial, omegaLanguage, omegaTranslationUrl } = require('./content.js');
const { omegaLogo, omegaImage, omegaVideo } = require('./media.js');
const { omegaMember, omegaPost } = require('./collections.js');

const TAGS = {
  iftruthy,
  iffalsy,
  iffile,
  urlmatches,
  omega_readtime: omegaReadtime,
  omega_fake_comments: omegaFakeComments,
  omega_external: omegaExternal,
  omega_social: omegaSocial,
  omega_language: omegaLanguage,
  omega_translation_url: omegaTranslationUrl,
  omega_logo: omegaLogo,
  omega_image: omegaImage,
  omega_video: omegaVideo,
  omega_member: omegaMember,
  omega_post: omegaPost,
};

module.exports = { TAGS };
