// Emits JSON the iOS app consumes, from the web app's curriculum.js / algo.js / app.js (the single source of truth).
// Run: node tools/gen-app-json.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const STATIC = 'src/main/resources/static';

globalThis.window = {};
require(`${process.cwd()}/${STATIC}/curriculum.js`);
require(`${process.cwd()}/${STATIC}/algo.js`);

const write = (name, data) => {
  writeFileSync(`${STATIC}/${name}.json`, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${STATIC}/${name}.json`);
};

for (const [name, data] of [['curriculum', window.CURRICULUM], ['algo', window.ALGO]]) {
  if (!data) throw new Error(`window.${name.toUpperCase()} not loaded`);
  write(name, data);
}

// Note templates live inside app.js; cut out the NOTE_TEMPLATES literal and render each body with placeholders
// the app fills in: ⟦title⟧ ⟦date⟧ ⟦weekLabel⟧, and ⟦isoYear⟧ ⟦isoWeek⟧ in a template's suggested note id.
const app = readFileSync(`${STATIC}/app.js`, 'utf8');
const start = app.indexOf('const NOTE_TEMPLATES = {');
const end = app.indexOf('\n  };\n', start);
if (start < 0 || end < 0) throw new Error('NOTE_TEMPLATES not found in app.js');
const literal = app.slice(start + 'const NOTE_TEMPLATES = '.length, end + '\n  }'.length);
const isoWeek = () => ({ year: '⟦isoYear⟧', week: '⟦isoWeek⟧' });
const templates = new Function('F', 'isoWeek', `return ${literal};`)('```', isoWeek);
const t = { title: '⟦title⟧', date: '⟦date⟧', weekLabel: '⟦weekLabel⟧' };
write('templates', Object.entries(templates).map(([key, v]) => ({
  key, label: v.label, body: v.body(t), ...(v.id ? { id: v.id() } : {}),
})));
