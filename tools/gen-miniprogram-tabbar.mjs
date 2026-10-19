// Renders the mini program's tab bar PNGs from the web app's cute icons (via miniprogram/utils/icons.js).
// Run on macOS: node tools/gen-miniprogram-tabbar.mjs
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
globalThis.wx = { getSystemInfoSync: () => ({ theme: 'light' }) };
const { icon } = require(`${process.cwd()}/miniprogram/utils/icons.js`);

const TABS = { dashboard: 'star', roadmap: 'flag', algo: 'code', notes: 'pencil', more: 'compass' };
const tmp = mkdtempSync(join(tmpdir(), 'tabbar-'));

// unselected tabs: same drawing in soft greys
const grey = svg => svg.replace(/#([0-9a-f]{6})/gi, (_, h) => {
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  const v = Math.round(150 + (0.299 * r + 0.587 * g + 0.114 * b) * 0.35).toString(16).padStart(2, '0');
  return `#${v}${v}${v}`;
});

for (const [tab, name] of Object.entries(TABS)) {
  const svg = Buffer.from(icon(name).split(',')[1], 'base64').toString().replace('<svg ', '<svg width="81" height="81" ');
  for (const [suffix, src] of [['-on', svg], ['', grey(svg)]]) {
    const file = join(tmp, `${tab}${suffix}.svg`);
    writeFileSync(file, src);
    execFileSync('sips', ['-s', 'format', 'png', file, '--out', `miniprogram/images/tab-${tab}${suffix}.png`], { stdio: 'ignore' });
  }
  console.log(`wrote miniprogram/images/tab-${tab}{,-on}.png`);
}
