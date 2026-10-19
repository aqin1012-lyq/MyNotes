/* The web app's Markdown dialect (see markdown()/inline() in src/main/resources/static/app.js),
   parsed into blocks + inline tokens that components/md renders. Emoji become the same cute icons. */
const store = require('./store');
const { emojiIcon, EMOJI_RE } = require('./icons');

const add = (cls, c) => (cls ? cls + ' ' : '') + c;
const PILL = { '+': 'lime', '!': 'pink', '~': 'gray' };

// inline tokens: x = text (c = classes), a = link (h = href), i = icon (s = src), p = progress, pill (ch = tokens), br
function parse(s, cls, inPill) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) out.push({ t: 'x', v: buf, c: cls }); buf = ''; };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const rest = s.slice(i);
    let m = null, toks = null;
    if (ch === '[' && (m = /^\[\[progress:(\d{1,3})\]\]/.exec(rest))) {
      toks = [{ t: 'p', v: Math.min(100, +m[1]) }];
    } else if (ch === '[' && (m = /^\[\[algo:([a-z0-9-]+)\]\]/.exec(rest))) {
      const p = store.problemBySlug[m[1]];
      toks = [{ t: 'a', v: p ? store.plabel(p) : m[1], h: `#/algo/${m[1]}`, c: cls }];
    } else if (ch === '[' && (m = /^\[\[([a-z0-9-]+)\]\]/.exec(rest))) {
      const t = store.topicById[m[1]];
      toks = [{ t: 'a', v: t ? t.title : m[1], h: `#/topic/${m[1]}`, c: cls }];
    } else if (ch === '[' && (m = /^\[([^\]]+)\]\(((?:https?:\/\/|#|\/)[^)\s]*)\)/.exec(rest))) {
      toks = [{ t: 'a', v: flat(parse(m[1], '', true)), h: m[2], c: cls }];
    } else if (ch === '*' && (m = /^\*\*([^*]+)\*\*/.exec(rest))) {
      toks = parse(m[1], add(cls, 'strong'), inPill);
    } else if (ch === '*' && s[i - 1] !== '*' && (m = /^\*([^*\s][^*]*)\*/.exec(rest))) {
      toks = parse(m[1], add(cls, 'em'), inPill);
    } else if (ch === '~' && (m = /^~~([^~]+)~~/.exec(rest))) {
      toks = parse(m[1], add(cls, 'del'), inPill);
    } else if (ch === '=' && (m = /^==([^=]+)==/.exec(rest))) {
      toks = parse(m[1], add(cls, 'mark'), inPill);
    } else if (ch === '{' && !inPill && (m = /^\{\{([+!~]?)([^{}]+)\}\}/.exec(rest))) {
      toks = [{ t: 'pill', k: PILL[m[1]] || 'purple', ch: parse(m[2], '', true) }];
    }
    if (toks) {
      flush();
      out.push(...toks);
      i += m[0].length;
    } else {
      buf += ch;
      i++;
    }
  }
  flush();
  return out;
}

const flat = toks => toks.map(t => t.v || '').join('');

// `code` is cut out first (as on the web), so formatting around it still matches
const CODE = /\u0000(\d+)\u0000/g;
function uncode(toks, codes) {
  const out = [];
  for (const t of toks) {
    if (t.t === 'pill') { out.push({ ...t, ch: uncode(t.ch, codes) }); continue; }
    if (t.t === 'a') { out.push({ ...t, v: t.v.replace(CODE, (_, n) => codes[n]) }); continue; }
    if (t.t !== 'x') { out.push(t); continue; }
    let last = 0, m;
    CODE.lastIndex = 0;
    while ((m = CODE.exec(t.v))) {
      if (m.index > last) out.push({ ...t, v: t.v.slice(last, m.index) });
      out.push({ t: 'x', v: codes[m[1]], c: add(t.c, 'code'), raw: 1 });
      last = m.index + m[0].length;
    }
    if (last < t.v.length) out.push(last ? { ...t, v: t.v.slice(last) } : t);
  }
  return out;
}

// emoji → cute icon, never inside code (same as the web's cutify)
function cutify(toks) {
  const out = [];
  for (const t of toks) {
    if (t.t === 'pill') { out.push({ ...t, ch: cutify(t.ch) }); continue; }
    if (t.t !== 'x' || t.raw) { out.push(t); continue; }
    let last = 0, m;
    EMOJI_RE.lastIndex = 0;
    while ((m = EMOJI_RE.exec(t.v))) {
      if (m.index > last) out.push({ ...t, v: t.v.slice(last, m.index) });
      out.push({ t: 'i', s: emojiIcon(m[1]) });
      last = m.index + m[0].length;
    }
    if (last < t.v.length) out.push(last ? { ...t, v: t.v.slice(last) } : t);
  }
  return out;
}

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  return cutify(uncode(parse(s, '', false), codes));
}

// plain text with only the emoji swapped, for titles
const emo = s => cutify([{ t: 'x', v: String(s == null ? '' : s), c: '' }]);

// search hits, wrapped in <mark> like the web's highlight()
function highlight(text, q) {
  text = String(text == null ? '' : text);
  if (!q) return emo(text);
  const out = [];
  const lower = text.toLowerCase(), needle = q.toLowerCase();
  let i = 0, j;
  while ((j = lower.indexOf(needle, i)) >= 0) {
    if (j > i) out.push({ t: 'x', v: text.slice(i, j), c: '' });
    out.push({ t: 'x', v: text.slice(j, j + q.length), c: 'mark' });
    i = j + q.length;
  }
  if (i < text.length) out.push({ t: 'x', v: text.slice(i), c: '' });
  return cutify(out);
}

// blocks: pre, callout (k = tip/warn/note), qa (:::details), fold, card, h, hr, quote, table, list, p
function markdown(src) {
  const lines = (src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let h2 = 0;
  const isTableSep = l => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));

  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push({ b: 'pre', v: buf.join('\n') });
    } else if ((m = /^:::(tip|warn|note|details|card|fold)\s*(.*)$/.exec(line))) {
      const buf = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ':::') buf.push(lines[i++]);
      i++;
      const kind = m[1];
      out.push({
        b: kind === 'details' ? 'qa' : ['fold', 'card'].includes(kind) ? kind : 'callout',
        k: kind, title: m[2] ? inline(m[2]) : null, ch: markdown(buf.join('\n')),
      });
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      const level = m[1].length;
      out.push({ b: 'h', l: level, id: level === 2 ? `sec-${++h2}` : '', inl: inline(m[2]), text: m[2] });
      i++;
    } else if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      out.push({ b: 'hr' });
      i++;
    } else if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push({ b: 'quote', ch: markdown(buf.join('\n')) });
    } else if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push({ b: 'table', head, rows });
    } else if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
      }
      const tasks = items.every(it => /^\[[ xX]\]\s/.test(it));
      out.push({
        b: 'list', ordered, tasks,
        items: items.map((it, n) => {
          const t = /^\[([ xX])\]\s(.*)$/.exec(it);
          return t ? { n: n + 1, task: t[1] === ' ' ? 1 : 2, inl: inline(t[2]) } : { n: n + 1, task: 0, inl: inline(it) };
        }),
      });
    } else if (!line.trim()) {
      i++;
    } else {
      const inl = [];
      while (i < lines.length && lines[i].trim() && !/^(```|:::|#{1,6}\s|>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) {
        if (inl.length) inl.push({ t: 'br' });
        inl.push(...inline(lines[i++]));
      }
      out.push({ b: 'p', inl });
    }
  }
  return out;
}

// the lesson TOC: top-level ## headings
const toc = blocks => blocks.filter(b => b.b === 'h' && b.id).map(b => ({ id: b.id, text: flat(inline(b.text)) }));

module.exports = { markdown, inline, emo, highlight, toc };
