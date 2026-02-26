/**
 * fix-data.mjs
 *
 * Fetches the three broken data files from the Pokemon Showdown CDN,
 * strips the CommonJS wrapper, and writes valid JSON to src/data/.
 *
 * Usage: node scripts/fix-data.mjs
 */

import { createContext, runInContext } from 'vm';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const TARGETS = [
  {
    url: 'https://play.pokemonshowdown.com/data/abilities.js',
    exportKey: 'BattleAbilities',
    outFile: join(ROOT, 'src/data/abilities.json'),
    minKeys: 200,
  },
  {
    url: 'https://play.pokemonshowdown.com/data/items.js',
    exportKey: 'BattleItems',
    outFile: join(ROOT, 'src/data/items.json'),
    minKeys: 100,
  },
  {
    url: 'https://play.pokemonshowdown.com/data/typechart.js',
    exportKey: 'BattleTypeChart',
    outFile: join(ROOT, 'src/data/typechart.json'),
    minKeys: 18,
  },
];

async function fetchAndStrip(target) {
  const { url, exportKey, outFile, minKeys } = target;

  console.log(`\nFetching: ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error(
      `Received HTML response (content-type: ${contentType}) for ${url}. ` +
      `This indicates a redirect or 404 page.`
    );
  }

  const text = await response.text();

  if (text.trimStart().startsWith('<!')) {
    throw new Error(
      `Response body starts with '<!' for ${url}. ` +
      `This is an HTML 404 page, not a JS data file.`
    );
  }

  // Strip CommonJS wrapper by running in a sandboxed VM context.
  // The .js files use patterns like:
  //   exports.BattleAbilities = { ... };
  // or:
  //   'use strict'; exports.BattleAbilities = { ... };
  const sandbox = { exports: {} };
  const context = createContext(sandbox);

  try {
    runInContext(text, context);
  } catch (err) {
    throw new Error(`VM execution failed for ${url}: ${err.message}`);
  }

  const data = sandbox.exports[exportKey];

  if (!data || typeof data !== 'object') {
    throw new Error(
      `Expected sandbox.exports["${exportKey}"] to be an object, ` +
      `got ${typeof data}. Keys available: ${Object.keys(sandbox.exports).join(', ')}`
    );
  }

  const keyCount = Object.keys(data).length;
  if (keyCount < minKeys) {
    throw new Error(
      `Validation failed for ${exportKey}: expected at least ${minKeys} entries, got ${keyCount}`
    );
  }

  // JSON.stringify drops function-valued keys (onStart, onModifyAtk, etc.)
  // This is intentional — Phase 1 only needs name, num, desc, flags, rating fields.
  const json = JSON.stringify(data, null, 2);
  writeFileSync(outFile, json, 'utf8');

  console.log(`  Written: ${outFile}`);
  console.log(`  Entries: ${keyCount}`);
  console.log(`  Size: ${(json.length / 1024).toFixed(1)} KB`);

  return keyCount;
}

async function main() {
  console.log('fix-data.mjs — fetching Pokemon Showdown data files');
  console.log('='.repeat(55));

  const results = [];

  for (const target of TARGETS) {
    try {
      const count = await fetchAndStrip(target);
      results.push({ target, count, ok: true });
    } catch (err) {
      console.error(`\nERROR processing ${target.exportKey}: ${err.message}`);
      results.push({ target, ok: false, error: err.message });
    }
  }

  console.log('\n' + '='.repeat(55));
  console.log('Summary:');
  for (const r of results) {
    if (r.ok) {
      console.log(`  [OK] ${r.target.exportKey}: ${r.count} entries`);
    } else {
      console.log(`  [FAIL] ${r.target.exportKey}: ${r.error}`);
    }
  }

  const failures = results.filter(r => !r.ok);
  if (failures.length > 0) {
    console.error(`\n${failures.length} file(s) failed. See errors above.`);
    process.exit(1);
  }

  console.log('\nAll files written successfully.');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
