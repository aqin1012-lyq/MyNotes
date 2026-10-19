// Emits JSON the iOS app consumes, from the web app's curriculum.js / algo.js (the single source of truth).
// Run: node tools/gen-app-json.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const STATIC = 'src/main/resources/static';

globalThis.window = {};
require(`${process.cwd()}/${STATIC}/curriculum.js`);
require(`${process.cwd()}/${STATIC}/algo.js`);

for (const [name, data] of [['curriculum', window.CURRICULUM], ['algo', window.ALGO]]) {
  if (!data) throw new Error(`window.${name.toUpperCase()} not loaded`);
  writeFileSync(`${STATIC}/${name}.json`, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${STATIC}/${name}.json`);
}
