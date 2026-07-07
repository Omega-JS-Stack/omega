/**
 * tags/index.js — the registered-name => tag-definition map.
 *
 * Names match jekyll-uj-powertools' Liquid registrations exactly (including
 * the four unprefixed ones: iftruthy, iffalsy, iffile, urlmatches) so
 * templates port verbatim. Each definition is `{ block, render(ctx, markup
 * [, renderInner]) }`; the engine adapter (register-liquid.js) builds `ctx`.
 */

const { iftruthy, iffalsy, iffile, urlmatches } = require('./conditionals.js');
const { ujReadtime, ujFakeComments, ujExternal, ujSocial, ujLanguage, ujTranslationUrl } = require('./content.js');
const { ujIcon, ujLogo, ujImage, ujVideo } = require('./media.js');
const { ujMember, ujPost } = require('./collections.js');

const TAGS = {
  iftruthy,
  iffalsy,
  iffile,
  urlmatches,
  uj_readtime: ujReadtime,
  uj_fake_comments: ujFakeComments,
  uj_external: ujExternal,
  uj_social: ujSocial,
  uj_language: ujLanguage,
  uj_translation_url: ujTranslationUrl,
  uj_icon: ujIcon,
  uj_logo: ujLogo,
  uj_image: ujImage,
  uj_video: ujVideo,
  uj_member: ujMember,
  uj_post: ujPost,
};

module.exports = { TAGS };
