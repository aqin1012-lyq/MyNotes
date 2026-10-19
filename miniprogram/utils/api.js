/* The web version's /api/study, re-implemented on wx storage (src/main/java/.../study/StudyStore.java): the mini program
 * has no backend, so each user's progress / log / attempts / notes stay on their own phone. Content is bundled. */
const { today } = require('./util');

const NOTE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ITEM_ID = /^[a-z0-9][a-z0-9:.-]{0,99}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

// storage keys: progress {itemId: date}, log [{date, minutes, topicId, text}], algo [{date, slug, result}],
// notes {id: updatedAt} as the index, note:<id> the content (a single key holds at most 1 MB)
const get = (key, empty) => wx.getStorageSync(key) || empty;
const put = (key, value) => wx.setStorageSync(key, value);
const noteKey = id => `note:${id}`;

function fail(status, message) {
  const e = new Error(`${status} ${message}`);
  e.status = status;
  throw e;
}

function check(re, id) {
  if (typeof id !== 'string' || !re.test(id)) fail(400, 'invalid id');
  return id;
}

const indexed = list => list.map((e, index) => ({ index, ...e }));

function deleteAt(key, index) {
  const list = get(key, []);
  if (!(index >= 0 && index < list.length)) fail(404, 'not found');
  list.splice(index, 1);
  put(key, list);
}

// ---------------------------------------------------------------- notes

function summarize(id, updatedAt, q) {
  const content = get(noteKey(id), '');
  let snippet = null;
  if (q) {
    const hit = content.toLowerCase().indexOf(q);
    if (hit < 0 && !id.includes(q)) return null;
    if (hit >= 0) {
      const from = Math.max(0, hit - 30), to = Math.min(content.length, hit + q.length + 50);
      snippet = (from > 0 ? '…' : '') + content.slice(from, to).replace(/\s+/g, ' ') + (to < content.length ? '…' : '');
    }
  }
  const lines = content.split('\n');
  const h1 = lines.find(l => l.startsWith('# '));
  const excerpt = lines.map(l => l.trim())
    .find(l => l && !/^(#|\||:::|```)/.test(l)) || '';
  return {
    id, title: h1 ? h1.slice(2).trim() : null, updatedAt, length: content.length,
    excerpt: excerpt.length > 80 ? excerpt.slice(0, 80) + '…' : excerpt, snippet,
  };
}

function notes(query) {
  const q = (query || '').trim().toLowerCase() || null;
  const index = get('notes', {});
  return Object.keys(index).map(id => summarize(id, index[id], q)).filter(Boolean)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function note(id) {
  const index = get('notes', {});
  return index[check(NOTE_ID, id)] ? { id, updatedAt: index[id], content: get(noteKey(id), '') } : null;
}

function saveNote(id, content) {
  check(NOTE_ID, id);
  const updatedAt = new Date().toISOString();
  put(noteKey(id), content || '');
  const index = get('notes', {});
  index[id] = updatedAt;
  put('notes', index);
  return { id, updatedAt, content };
}

function renameNote(id, newId) {
  check(NOTE_ID, id);
  check(NOTE_ID, newId);
  const index = get('notes', {});
  if (!index[id]) fail(404, 'not found');
  if (index[newId]) fail(409, 'a note with that id already exists');
  put(noteKey(newId), get(noteKey(id), ''));
  wx.removeStorageSync(noteKey(id));
  index[newId] = index[id];
  delete index[id];
  put('notes', index);
  return note(newId);
}

function deleteNote(id) {
  check(NOTE_ID, id);
  const index = get('notes', {});
  delete index[id];
  put('notes', index);
  wx.removeStorageSync(noteKey(id));
}

// ---------------------------------------------------------------- routes

const ROUTES = [
  ['GET', /^\/progress$/, () => get('progress', {})],
  ['PUT', /^\/progress\/([^/]+)$/, (b, id) => {
    const progress = get('progress', {});
    check(ITEM_ID, id);
    if (b.done) progress[id] = progress[id] || today();
    else delete progress[id];
    put('progress', progress);
    return progress;
  }],
  ['GET', /^\/log$/, () => indexed(get('log', []))],
  ['POST', /^\/log$/, b => {
    if (!b.date || !(b.minutes > 0 && b.minutes <= 24 * 60)) fail(400, 'date required, minutes must be 1..1440');
    const entry = {
      date: b.date, minutes: b.minutes,
      topicId: b.topicId ? check(NOTE_ID, b.topicId) : '-',
      text: (b.text || '').replace(/[\t\r\n]+/g, ' ').trim(),
    };
    const log = get('log', []);
    log.push(entry);
    put('log', log);
    return { index: log.length - 1, ...entry };
  }],
  ['DELETE', /^\/log\/(\d+)$/, (b, i) => deleteAt('log', Number(i))],
  ['GET', /^\/algo$/, () => indexed(get('algo', []))],
  ['POST', /^\/algo$/, b => {
    check(SLUG, b.slug);
    if (!['ac', 'fail'].includes(b.result)) fail(400, 'result must be ac or fail');
    const attempt = { date: today(), slug: b.slug, result: b.result };
    const algo = get('algo', []);
    algo.push(attempt);
    put('algo', algo);
    return { index: algo.length - 1, ...attempt };
  }],
  ['DELETE', /^\/algo\/(\d+)$/, (b, i) => deleteAt('algo', Number(i))],
  ['GET', /^\/notes(?:\?q=(.*))?$/, (b, q) => notes(q && decodeURIComponent(q))],
  ['GET', /^\/notes\/([^/]+)$/, (b, id) => note(id)],
  ['PUT', /^\/notes\/([^/]+)$/, (b, id) => saveNote(id, b.content)],
  ['POST', /^\/notes\/([^/]+)\/rename$/, (b, id) => renameNote(id, b.newId)],
  ['DELETE', /^\/notes\/([^/]+)$/, (b, id) => deleteNote(id)],
];

// same contract as before: resolves to the response body (null for a missing GET), rejects with "<status> …" otherwise
async function study(path, method = 'GET', body) {
  for (const [m, re, handler] of ROUTES) {
    const match = m === method && path.match(re);
    if (!match) continue;
    try {
      const result = handler(body || {}, ...match.slice(1).map(s => (s == null ? s : decodeURIComponent(s))));
      return result === undefined ? null : result;
    } catch (e) {
      if (e.status) throw new Error(`${method} ${path} → ${e.message}`);
      throw new Error(e.errMsg || e.message || String(e)); // e.g. storage full
    }
  }
  throw new Error(`${method} ${path} → 404`);
}

// ---------------------------------------------------------------- bundled content

// lessons/<topic-id>.md and algo/<slug>.md live in subpackages, downloaded the first time one is opened
async function text(path) {
  const [, dir, name] = path.match(/^(lessons|algo)\/(.+)\.md$/) || [];
  if (!dir) return null;
  const files = dir === 'lessons'
    ? await require.async('../pkg-lessons/lessons.js')
    : await require.async('../pkg-algo/solutions.js');
  return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null;
}

async function json(path) {
  if (path === 'curriculum.json') return require('../content/curriculum');
  if (path === 'algo.json') return require('../content/algo');
  throw new Error(`没有打包 ${path}`);
}

module.exports = { study, text, json };
