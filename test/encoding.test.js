// -----------------------------------------------------------------------------
// The texts users and contributors read are UTF-8 without BOM, never
// mojibake (UTF-8 bytes read as Latin-1 / Windows-1252 and saved again: "é"
// becoming "Ã" + "©"), and no file carries a control byte nor a hidden
// bidirectional character.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOJIBAKE =
  /[ÂÃÅ][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u203a\u20ac\u2122]|â[\u201a\u20ac]/;
/** Hidden, invisible or look-alike blank characters (written as escapes). */
/* eslint-disable no-control-regex, no-misleading-character-class */
const HIDDEN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00a0\u00ad\u034f\u061c\u115f-\u1160\u17b4-\u17b5\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffd\u{e0000}-\u{e007f}]/u;
/* eslint-enable no-control-regex, no-misleading-character-class */
const FILES = [
  'gladys-assistant-integration.json',
  'docs/en.md',
  'docs/fr.md',
  'README.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'TODO.md',
  'THIRD_PARTY_NOTICES.md',
  'SECURITY.md',
  'src/i18n.js',
  'src/model.js',
  'src/constants.js',
];

const root = fileURLToPath(new URL('..', import.meta.url));

for (const file of FILES) {
  test(`${file}: UTF-8 without BOM, no mojibake`, () => {
    const bytes = readFileSync(join(root, file));
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM');
    const text = bytes.toString('utf8');
    assert.ok(!text.includes('\ufffd'), 'invalid UTF-8');
    const line = text.split('\n').findIndex((l) => MOJIBAKE.test(l));
    assert.equal(line, -1, `mojibake on line ${line + 1}`);
  });
}

/** Every text file of the repository (not node_modules, .git, images). */
function* sources(dir = root) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'data'].includes(name)) {
      continue;
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      yield* sources(path);
    } else if (/\.(js|mjs|json|md|yml|yaml)$|^(Dockerfile|LICENSE|\.\w+)$/.test(name)) {
      yield path;
    }
  }
}

test('no control byte, BOM or hidden bidirectional character in any text file', () => {
  let count = 0;
  for (const path of sources()) {
    const bytes = readFileSync(path);
    const bad = bytes.findIndex(
      (b) => (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f,
    );
    assert.equal(bad, -1, `${path}: control byte at ${bad}`);
    const text = bytes.toString('utf8');
    const hiddenAt = text.search(HIDDEN);
    assert.equal(hiddenAt, -1, `${path}: hidden character at ${hiddenAt}`);
    count += 1;
  }
  assert.ok(count > 20);
});

test('the mojibake pattern catches what it should', () => {
  assert.match('FranÃ§ais', MOJIBAKE, 'ç read as Latin-1');
  assert.match('Â«', MOJIBAKE, '« read as Latin-1');
  assert.match('lâ€™app', MOJIBAKE, '’ read as Windows-1252');
  assert.doesNotMatch('Français « Découverte » 800×534 — l’app…', MOJIBAKE);
  // Every accented letter of French, upper case included, read as Windows-1252.
  const cp1252 = new TextDecoder('windows-1252');
  for (const ch of 'ÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆàâäçéèêëîïôöùûüÿœæ«»’“”…—–€°×') {
    const broken = cp1252.decode(Buffer.from(`x${ch}x`, 'utf8'));
    assert.match(broken, MOJIBAKE, `${ch} read as Windows-1252: ${broken}`);
  }
});

test('the hidden pattern catches what it should', () => {
  const codes = [
    0x00, 0x0b, 0x1f, 0x7f, 0x85, 0xa0, 0xad, 0x34f, 0x61c, 0x180e, 0x2000, 0x200b, 0x200f, 0x2028,
    0x2029, 0x202e, 0x202f, 0x205f, 0x2060, 0x2065, 0x2066, 0x2069, 0x3000, 0xfe00, 0xfe0f, 0xfeff,
    0xfffd, 0xe0001, 0xe007f,
  ];
  for (const code of codes) {
    assert.match(`a${String.fromCodePoint(code)}b`, HIDDEN, code.toString(16));
  }
  assert.doesNotMatch('Français « Découverte » 800×534 — l’app… \t', HIDDEN);
});

test('LICENSE names nobody', () => {
  const license = readFileSync(join(root, 'LICENSE'), 'utf8');
  assert.match(license, /Apache License/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  assert.doesNotMatch(license, /Copyright (?:\(c\) )?\d{4}/i);
});
