/**
 * The ONE `<html>` stamp reader (P1). Both post-build passes that read a stamp
 * off a built page go through `readHtmlStamp`, so neither can disagree with the
 * other about quoting: production HTML runs through the minifier on its way to
 * dist and comes out `data-omega-path-prefix=/workkit`, unquoted. A reader that
 * only accepts double quotes answers '' on every production page.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { readHtmlStamp } = require('../src/html-stamp.js');
const { minifyHtml } = require('../src/minify-html.js');
const { readPathPrefixStamp } = require('../src/path-prefix.js');
const { readTranslateStamp } = require('../src/translate/route-include.js');

const PAGE = [
  '<!DOCTYPE html>',
  '<html lang="en" data-omega-path-prefix="/workkit" data-omega-translate="false">',
  '<head><title>Stamped</title></head>',
  '<body><p>hi</p></body>',
  '</html>',
].join('\n');

module.exports = defineCases({
  type: 'group',
  description: 'html-stamp',
  tests: [
    {
      name: 'readHtmlStamp: the stamp survives the real minifier, quoted or not',
      run: (ctx) => {
        const minified = minifyHtml(PAGE);
        ctx.expect(minified, 'the minifier the build runs drops the attribute quotes').toBe('<!doctype html><html data-omega-path-prefix=/workkit data-omega-translate=false lang=en><title>Stamped</title><body><p>hi');

        ctx.expect(readHtmlStamp(minified, 'data-omega-path-prefix'), 'unquoted value').toBe('/workkit');
        ctx.expect(readHtmlStamp(PAGE, 'data-omega-path-prefix'), 'double-quoted value').toBe('/workkit');
        ctx.expect(readHtmlStamp("<html data-omega-path-prefix='/workkit'>", 'data-omega-path-prefix'), 'single-quoted value').toBe('/workkit');
        ctx.expect(readHtmlStamp('<html lang="en">', 'data-omega-path-prefix'), 'an unstamped page answers null').toBe(null);
      },
    },

    {
      name: 'both stamp readers read a MINIFIED page (#355 mount + #858 page switch)',
      run: (ctx) => {
        const minified = minifyHtml(PAGE);

        ctx.expect(readPathPrefixStamp(minified), 'the mount point survives minification').toBe('/workkit');
        ctx.expect(readTranslateStamp(minified), "the page's own translate answer survives minification").toBe(false);
      },
    },
  ],
});
