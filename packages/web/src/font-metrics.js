/**
 * The font metric reader (#768): the five numbers a metric-matched fallback
 * face is built from, read straight out of a font FILE.
 *
 *   unitsPerEm, ascent, descent, lineGap, avgCharWidth
 *
 * It reads a WOFF2 (what every theme vendors) and a bare sfnt / collection
 * (what a system family on the build machine is) with NO dependency: a WOFF2
 * is a header, a table directory, then ONE brotli stream holding the tables in
 * directory order, so node's own `zlib.brotliDecompressSync` plus the
 * directory parse below reaches every table exactly. Nothing here decodes a
 * glyph OUTLINE, only `head`, `hhea`, `OS/2`, `cmap` and the advance widths
 * in `hmtx`, which is why one file covers what a font library would.
 *
 * Which ascent/descent: `OS/2`'s sTypo* values when the face sets fsSelection
 * bit 7 (USE_TYPO_METRICS), the bit whose whole meaning is "use these", else
 * `hhea`'s. That is what a browser does, so the overrides computed from these
 * numbers describe the box the browser will actually lay out.
 */

// Libraries
const zlib = require('node:zlib');
const fs = require('fs-jetpack');

// Signatures. A WOFF2 is 'wOF2'; a bare sfnt is 1.0 (TrueType outlines),
// 'OTTO' (CFF outlines) or the old Apple 'true'; a collection is 'ttcf'.
const WOFF2 = 0x774f4632;
const TTCF = 0x74746366;
const SFNT = new Set([0x00010000, 0x4f54544f, 0x74727565]);

const WOFF2_HEADER_BYTES = 48;
const SFNT_RECORD_BYTES = 16;

// The WOFF2 known-tag table (spec § 5.2, Table 4), in ITS order: a directory
// entry's low 6 bits index it. The one index that is not a lookup is 63: it
// means the table does not name this tag, and the 4 bytes follow inline.
const CUSTOM_TAG = 0x3f;
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'ltag', 'morx', 'mort', 'opbd',
  'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

// Table field offsets, for the tables this reader reads fields from, by their spec
// layouts (head § 5.2.2, hhea § 5.2.3, OS/2 § 5.2.4 of the OpenType spec).
const HEAD_UNITS_PER_EM = 18;
const HHEA_ASCENDER = 4;
const HHEA_NUM_H_METRICS = 34;
const OS2_FS_SELECTION = 62;
const OS2_TYPO_ASCENDER = 68;
const OS2_MIN_BYTES = 78;
const USE_TYPO_METRICS = 0x80; // fsSelection bit 7
const CMAP_PLATFORM_UNICODE = 0;
const CMAP_PLATFORM_WINDOWS = 3;

// The width sample: ordinary English prose, MEASURED per font as the mean
// advance over its characters. It is the honest way to ask the one question
// size-adjust answers: "how much wider does this family set the same text?"
//
// OS/2's own xAvgCharWidth is NOT that number and cannot be compared across
// families. The spec redefined it (version 0-1: an English-weighted average of
// the lowercase letters; version 3+: the arithmetic mean of every non-zero
// advance), and a vendor restating the table version does not restate the
// value: Arial's file says version 3 and still carries 904, its 1990s
// lowercase figure, while its measured mean advance over this sample is 891.
// So a ratio of two xAvgCharWidth fields compares two different quantities:
// off OS/2, classy's Newsreader fallback would size-adjust to 123.5% of
// Georgia when the text it sets measures 91.2% of Georgia's width, and Inter's
// would be 145.0% of Arial instead of 106.9%. Measuring both sides here keeps
// ONE definition on both ends of every ratio.
const WIDTH_SAMPLE = 'the sun rose over the quiet harbor, and a small boat set out with the morning tide';

/**
 * @typedef {object} FontMetrics
 * @property {number} unitsPerEm - the em square, every other value's unit
 * @property {number} ascent - above the baseline, positive
 * @property {number} descent - below it, NEGATIVE (as the font stores it)
 * @property {number} lineGap - the leading between two lines
 * @property {number} avgCharWidth - the mean advance over WIDTH_SAMPLE, what size-adjust matches on
 */

/**
 * Read one font's metrics.
 * @param {Buffer} buffer - a WOFF2, sfnt (ttf/otf) or collection file
 * @param {number} [fontIndex] - which font of a collection (default the first)
 * @returns {FontMetrics}
 */
function readFontMetrics(buffer, fontIndex = 0) {
  const { tables, transformed } = readTables(buffer, fontIndex);
  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const os2 = tables.get('OS/2');
  if (!head || head.length < HEAD_UNITS_PER_EM + 2) throw new Error('font file: no readable head table');
  if (!hhea || hhea.length < HHEA_ASCENDER + 6) throw new Error('font file: no readable hhea table');
  if (!os2 || os2.length < OS2_MIN_BYTES) throw new Error('font file: no readable OS/2 table');

  const typo = (os2.readUInt16BE(OS2_FS_SELECTION) & USE_TYPO_METRICS) !== 0;
  const vertical = typo ? os2 : hhea;
  const at = typo ? OS2_TYPO_ASCENDER : HHEA_ASCENDER;

  return {
    unitsPerEm: head.readUInt16BE(HEAD_UNITS_PER_EM),
    ascent: vertical.readInt16BE(at),
    descent: vertical.readInt16BE(at + 2),
    lineGap: vertical.readInt16BE(at + 4),
    avgCharWidth: averageCharWidth(tables, transformed, hhea),
  };
}

/**
 * The mean advance width over WIDTH_SAMPLE, in font units: `cmap` maps each
 * character to its glyph, `hmtx` carries that glyph's advance. A character the
 * face does not cover is left out of the mean rather than counted as zero.
 * @param {Map<string, Buffer>} tables - the font's tables
 * @param {Set<string>} transformed - the tags stored in a WOFF2 transform
 * @param {Buffer} hhea - the hhea table (it names how many advances hmtx holds)
 * @returns {number}
 */
function averageCharWidth(tables, transformed, hhea) {
  const cmap = tables.get('cmap');
  const hmtx = tables.get('hmtx');
  if (!cmap || !hmtx) throw new Error('font file: no readable cmap/hmtx tables');

  const glyphOf = characterMap(cmap);
  const advanceOf = advanceReader(hmtx, hhea.readUInt16BE(HHEA_NUM_H_METRICS), transformed.has('hmtx'));
  let total = 0;
  let counted = 0;
  for (const character of WIDTH_SAMPLE) {
    const glyph = glyphOf(character.codePointAt(0));
    if (glyph === 0) continue;

    total += advanceOf(glyph);
    counted += 1;
  }

  if (counted === 0) throw new Error('font file: covers none of the width sample');

  return total / counted;
}

/**
 * A glyph's advance width. A `hmtx` stored in a WOFF2 transform drops the left
 * side bearings but keeps every advance, behind one flags byte, and those
 * advances are the whole reason this reader opens the table. The last advance covers
 * every glyph past `numberOfHMetrics` (a monospaced tail).
 * @param {Buffer} hmtx - the hmtx table
 * @param {number} numberOfHMetrics - hhea's count of full metric records
 * @param {boolean} transformed - is this the WOFF2 transformed form?
 * @returns {function(number): number}
 */
function advanceReader(hmtx, numberOfHMetrics, transformed) {
  return (glyph) => {
    const index = Math.min(glyph, numberOfHMetrics - 1);
    const at = transformed ? 1 + index * 2 : index * 4;
    if (at + 2 > hmtx.length) throw new Error('font file: truncated hmtx table');

    return hmtx.readUInt16BE(at);
  };
}

/**
 * A codepoint → glyph id lookup over the font's best unicode `cmap` subtable:
 * format 12 (full unicode) when the face ships one, else format 4 (the BMP
 * form every latin face carries). 0 means "not covered" in both.
 * @param {Buffer} cmap - the cmap table
 * @returns {function(number): number}
 */
function characterMap(cmap) {
  let best = null;
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i += 1) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const offset = cmap.readUInt32BE(8 + i * 8);
    if (platform !== CMAP_PLATFORM_UNICODE && platform !== CMAP_PLATFORM_WINDOWS) continue;

    const format = cmap.readUInt16BE(offset);
    if (format !== 4 && format !== 12) continue;
    if (!best || format > best.format) best = { offset, format };
  }

  if (!best) throw new Error('font file: no unicode cmap subtable');

  return best.format === 12 ? segmentedCoverage(cmap, best.offset) : segmentMapping(cmap, best.offset);
}

/**
 * cmap format 4: parallel arrays of segments, each mapping a codepoint range
 * either by a delta or through the glyph id array that follows.
 * @param {Buffer} cmap - the cmap table
 * @param {number} offset - the subtable's offset
 * @returns {function(number): number}
 */
function segmentMapping(cmap, offset) {
  const segments = cmap.readUInt16BE(offset + 6) / 2;
  const ends = offset + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;

  return (codepoint) => {
    if (codepoint > 0xffff) return 0;

    for (let i = 0; i < segments; i += 1) {
      if (codepoint > cmap.readUInt16BE(ends + i * 2)) continue;
      if (codepoint < cmap.readUInt16BE(starts + i * 2)) return 0;

      const delta = cmap.readInt16BE(deltas + i * 2);
      const range = cmap.readUInt16BE(ranges + i * 2);
      if (range === 0) return (codepoint + delta) & 0xffff;

      const glyph = cmap.readUInt16BE(ranges + i * 2 + range + (codepoint - cmap.readUInt16BE(starts + i * 2)) * 2);

      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }

    return 0;
  };
}

/**
 * cmap format 12: groups of contiguous codepoints, each naming the glyph its
 * first codepoint maps to.
 * @param {Buffer} cmap - the cmap table
 * @param {number} offset - the subtable's offset
 * @returns {function(number): number}
 */
function segmentedCoverage(cmap, offset) {
  const groups = cmap.readUInt32BE(offset + 12);

  return (codepoint) => {
    for (let i = 0; i < groups; i += 1) {
      const group = offset + 16 + i * 12;
      const start = cmap.readUInt32BE(group);
      if (codepoint < start) return 0;
      if (codepoint > cmap.readUInt32BE(group + 4)) continue;

      return cmap.readUInt32BE(group + 8) + (codepoint - start);
    }

    return 0;
  };
}

/**
 * Read one font file's metrics from disk.
 * @param {string} file - path to a WOFF2 / sfnt / collection
 * @param {number} [fontIndex] - which font of a collection
 * @returns {FontMetrics}
 */
function readFontMetricsFile(file, fontIndex = 0) {
  const buffer = fs.read(file, 'buffer');
  if (!buffer) throw new Error(`font file: ${file} does not exist`);

  return readFontMetrics(buffer, fontIndex);
}

/**
 * The tables of a font file, by tag, and which of them are stored in a WOFF2
 * transform (a transformed table's bytes are not its sfnt bytes). WOFF2
 * decompresses; sfnt and collections are sliced in place.
 * @param {Buffer} buffer - the file
 * @param {number} fontIndex - which font of a collection
 * @returns {{tables: Map<string, Buffer>, transformed: Set<string>}}
 */
function readTables(buffer, fontIndex) {
  if (!Buffer.isBuffer(buffer) || buffer.length < WOFF2_HEADER_BYTES) {
    throw new Error('font file: truncated, too short to hold a font header');
  }

  const signature = buffer.readUInt32BE(0);
  if (signature === WOFF2) return woff2Tables(buffer);
  if (signature === TTCF) return sfntTables(buffer, buffer.readUInt32BE(12 + fontIndex * 4));
  if (SFNT.has(signature)) return sfntTables(buffer, 0);

  throw new Error(`font file: unrecognized signature 0x${signature.toString(16)}: not a woff2, sfnt or collection`);
}

/**
 * The tables of a bare sfnt: an offset table, then 16-byte records naming a
 * tag and an absolute slice of the file (absolute even inside a collection,
 * which is what makes a collection a list of offset tables and nothing more).
 * @param {Buffer} buffer - the file
 * @param {number} offset - where this font's offset table starts
 * @returns {{tables: Map<string, Buffer>, transformed: Set<string>}}
 */
function sfntTables(buffer, offset) {
  const numTables = buffer.readUInt16BE(offset + 4);
  const tables = new Map();
  for (let i = 0; i < numTables; i += 1) {
    const record = offset + 12 + i * SFNT_RECORD_BYTES;
    if (record + SFNT_RECORD_BYTES > buffer.length) throw new Error('font file: truncated table directory');

    const tag = buffer.toString('latin1', record, record + 4);
    const start = buffer.readUInt32BE(record + 8);
    const length = buffer.readUInt32BE(record + 12);
    if (start + length <= buffer.length) tables.set(tag, buffer.subarray(start, start + length));
  }

  return { tables, transformed: new Set() };
}

/**
 * The tables of a WOFF2: the directory names each table and its length, and
 * ONE brotli stream holds their bytes end to end in directory order.
 * @param {Buffer} buffer - the file
 * @returns {{tables: Map<string, Buffer>, transformed: Set<string>}}
 */
function woff2Tables(buffer) {
  if (buffer.readUInt32BE(4) === TTCF) throw new Error('font file: WOFF2 collections are not supported');

  const numTables = buffer.readUInt16BE(12);
  const compressedLength = buffer.readUInt32BE(20);
  const transformed = new Set();
  const directory = [];
  let at = WOFF2_HEADER_BYTES;
  for (let i = 0; i < numTables; i += 1) {
    if (at >= buffer.length) throw new Error('font file: truncated WOFF2 table directory');

    const flags = buffer[at];
    at += 1;
    let tag = KNOWN_TAGS[flags & CUSTOM_TAG];
    if ((flags & CUSTOM_TAG) === CUSTOM_TAG) {
      tag = buffer.toString('latin1', at, at + 4);
      at += 4;
    }

    let length;
    [length, at] = readUIntBase128(buffer, at);
    // A transformed table stores its TRANSFORMED length too, and that is the
    // length its bytes occupy in the stream. The version lives in the flag's
    // top two bits, and the null transform is version 0, except for
    // glyf/loca, whose null transform is version 3 (WOFF2 spec § 5.2).
    const version = flags >> 6;
    if ((tag === 'glyf' || tag === 'loca') ? version !== 3 : version !== 0) {
      transformed.add(tag);
      [length, at] = readUIntBase128(buffer, at);
    }

    directory.push({ tag, length });
  }

  if (at + compressedLength > buffer.length) throw new Error('font file: truncated WOFF2 payload');

  const stream = zlib.brotliDecompressSync(buffer.subarray(at, at + compressedLength));
  const tables = new Map();
  let cursor = 0;
  for (const { tag, length } of directory) {
    if (cursor + length <= stream.length) tables.set(tag, stream.subarray(cursor, cursor + length));
    cursor += length;
  }

  return { tables, transformed };
}

/**
 * A WOFF2 UIntBase128: up to five bytes, seven value bits each, the high bit
 * marking "one more byte".
 * @param {Buffer} buffer - the file
 * @param {number} offset - where the number starts
 * @returns {[number, number]} the value and the offset past it
 */
function readUIntBase128(buffer, offset) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    if (offset + i >= buffer.length) throw new Error('font file: truncated UIntBase128');

    const byte = buffer[offset + i];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, offset + i + 1];
  }

  throw new Error('font file: malformed UIntBase128');
}

// The system side of every ratio. A build machine cannot read the font a
// VISITOR falls back to, so these are checked in, MEASURED, never typed from
// memory: each row is `readFontMetricsFile()` run on 2026-09-02 against the
// macOS 15 (Darwin 25.6) system file named beside it, so a re-measure
// reproduces them exactly. The two collections are read at font 0, whose
// vertical metrics match the published Helvetica (1577/-471/0) and Helvetica
// Neue (952/-213/28) values, which is the cross-check that font 0 is the regular.
//
// Keys are lowercase (a css font stack writes a family name however it likes),
// and each row carries the family's canonical spelling for the generated
// `local()` to name.
const SYSTEM_FONT_METRICS = {
  // /System/Library/Fonts/Supplemental/Arial.ttf
  arial: { family: 'Arial', unitsPerEm: 2048, ascent: 1854, descent: -434, lineGap: 67, avgCharWidth: 891.317 },
  // /System/Library/Fonts/Helvetica.ttc (font 0)
  helvetica: { family: 'Helvetica', unitsPerEm: 2048, ascent: 1577, descent: -471, lineGap: 0, avgCharWidth: 891.317 },
  // /System/Library/Fonts/HelveticaNeue.ttc (font 0)
  'helvetica neue': { family: 'Helvetica Neue', unitsPerEm: 1000, ascent: 952, descent: -213, lineGap: 28, avgCharWidth: 440.951 },
  // /System/Library/Fonts/Supplemental/Georgia.ttf
  georgia: { family: 'Georgia', unitsPerEm: 2048, ascent: 1878, descent: -449, lineGap: 0, avgCharWidth: 891.878 },
  // /System/Library/Fonts/Supplemental/Times New Roman.ttf
  'times new roman': { family: 'Times New Roman', unitsPerEm: 2048, ascent: 1825, descent: -443, lineGap: 87, avgCharWidth: 803.890 },
  // /System/Library/Fonts/Supplemental/Verdana.ttf
  verdana: { family: 'Verdana', unitsPerEm: 2048, ascent: 2059, descent: -430, lineGap: 0, avgCharWidth: 1036.415 },
};

/**
 * The metrics of the common system families, MEASURED with the reader above
 * from the files on a macOS build machine (see the provenance comment on
 * SYSTEM_FONT_METRICS): the other half of every override, since the fallback
 * face is a system font no build can read on every platform it renders on.
 * @param {string} family - a family name as a css font stack writes it
 * @returns {FontMetrics|null} null when the table does not know the family
 */
function systemFontMetrics(family) {
  const name = String(family).trim().replace(/^['"]|['"]$/g, '').toLowerCase();

  return SYSTEM_FONT_METRICS[name] || null;
}

module.exports = { readFontMetrics, readFontMetricsFile, systemFontMetrics, SYSTEM_FONT_METRICS };
