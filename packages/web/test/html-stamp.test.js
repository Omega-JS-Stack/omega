/**
 * The ONE `<html>` stamp reader (P1). Both post-build passes that read a stamp
 * off a built page go through `readHtmlStamp`, so neither can disagree with the
 * other about quoting: production HTML runs through the minifier on its way to
 * dist and comes out `data-omega-path-prefix=/workkit`, unquoted. A reader that
 * only accepts double quotes answers '' on every production page.
 */
const assert = require('node:assert');
const { test } = require('node:test');

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

test('readHtmlStamp: the stamp survives the real minifier, quoted or not', () => {
  const minified = minifyHtml(PAGE);
  assert.equal(
    minified,
    '<!doctype html><html data-omega-path-prefix=/workkit data-omega-translate=false lang=en><title>Stamped</title><body><p>hi',
    'the minifier the build runs drops the attribute quotes',
  );

  assert.equal(readHtmlStamp(minified, 'data-omega-path-prefix'), '/workkit', 'unquoted value');
  assert.equal(readHtmlStamp(PAGE, 'data-omega-path-prefix'), '/workkit', 'double-quoted value');
  assert.equal(readHtmlStamp("<html data-omega-path-prefix='/workkit'>", 'data-omega-path-prefix'), '/workkit', 'single-quoted value');
  assert.equal(readHtmlStamp('<html lang="en">', 'data-omega-path-prefix'), null, 'an unstamped page answers null');
});

test('both stamp readers read a MINIFIED page (#355 mount + #858 page switch)', () => {
  const minified = minifyHtml(PAGE);

  assert.equal(readPathPrefixStamp(minified), '/workkit', 'the mount point survives minification');
  assert.equal(readTranslateStamp(minified), false, "the page's own translate answer survives minification");
});
