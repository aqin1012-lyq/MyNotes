/* MyNotes 学习站：路由 + 视图 + 进度 / 笔记 / 日志。数据来自 curriculum.js 与 /api/study。 */
(() => {
  'use strict';

  const C = window.CURRICULUM;
  const main = document.getElementById('main');
  const state = { progress: {}, log: [], notes: [], attempts: [] };

  // ---------------------------------------------------------------- helpers

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, method = 'GET', body) {
    const res = await fetch('/api/study' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const thisMonth = () => today().slice(0, 7);
  const pct = (done, total) => total ? Math.round(done * 100 / total) : 0;
  const hours = min => (min / 60).toFixed(min >= 600 ? 0 : 1);

  // ---------------------------------------------------------------- curriculum index

  const topics = [];
  C.stages.forEach(stage => stage.topics.forEach(t => { t.stage = stage; topics.push(t); }));
  const topicById = Object.fromEntries(topics.map(t => [t.id, t]));

  // progress item ids: l = 讲义, k = 知识点, p = 实践, r = 资料, m = 项目里程碑
  const lessonItem = t => `${t.id}:l0`; // "已读完讲义"
  const topicItems = t => [
    lessonItem(t),
    ...t.points.map((_, i) => `${t.id}:k${i}`),
    ...(t.practice || []).map((_, i) => `${t.id}:p${i}`),
    ...(t.resources || []).map((_, i) => `${t.id}:r${i}`),
  ];
  const projectItems = p => p.milestones.map((_, i) => `${p.id}:m${i}`);

  function stats(ids) {
    const done = ids.filter(id => state.progress[id]).length;
    return { done, total: ids.length, pct: pct(done, ids.length) };
  }
  const topicStats = t => stats(topicItems(t));
  const stageStats = s => stats(s.topics.flatMap(topicItems));

  function currentStage() {
    const m = thisMonth();
    return C.stages.find(s => s.from <= m && m <= s.to)
      || (m < C.stages[0].from ? C.stages[0] : C.stages.find(s => stageStats(s).pct < 100) || C.stages.at(-1));
  }

  function nextTopic() {
    return topics.find(t => topicStats(t).pct < 100);
  }

  // ---------------------------------------------------------------- algorithm practice (algo.js + study/algo.tsv)

  const ALGO = window.ALGO;
  const problemBySlug = Object.fromEntries(ALGO.problems.map(p => [p.slug, p]));
  const DIFF = { E: '简单', M: '中等', H: '困难' };
  const setById = Object.fromEntries(ALGO.sets.map(x => [x.id, x]));
  const catOf = p => setById[p.set].categories.find(c => c.id === p.cat);
  const plabel = p => (p.no ? `${p.no}. ` : '') + p.title;
  let algoSet = localStorage.getItem('algoSet') || ALGO.sets[0].id;
  const addDays = (date, n) => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };

  // new → (fail) retry next day → (ac) review after 1/3/7/14/30/60 days of consecutive successes → mastered
  function algoStatus(slug) {
    const tries = state.attempts.filter(a => a.slug === slug);
    if (!tries.length) return { state: 'new', label: '未做', tries };
    const last = tries.at(-1);
    const solved = tries.some(a => a.result === 'ac');
    if (last.result === 'fail') {
      const due = addDays(last.date, 1);
      return { state: due <= today() ? 'due' : 'retry', label: '待重做', due, tries, solved };
    }
    let streak = 0;
    for (let i = tries.length - 1; i >= 0 && tries[i].result === 'ac'; i--) streak++;
    if (streak > ALGO.review.length) return { state: 'mastered', label: '已掌握', tries, solved };
    const due = addDays(last.date, ALGO.review[streak - 1]);
    return { state: due <= today() ? 'due' : 'learning', label: due <= today() ? '该复习了' : '复习中', due, tries, solved, streak };
  }

  function algoStats(setId) {
    const all = ALGO.problems.filter(p => !setId || p.set === setId).map(p => ({ p, st: algoStatus(p.slug) }));
    return {
      all,
      solved: all.filter(x => x.st.solved).length,
      due: all.filter(x => x.st.state === 'due'),
      mastered: all.filter(x => x.st.state === 'mastered').length,
    };
  }

  // ---------------------------------------------------------------- markdown (escape first, so notes can never inject HTML)

  function inline(s) {
    const codes = [];
    s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = s
      .replace(/\[\[progress:(\d{1,3})\]\]/g, (_, n) => { const v = Math.min(100, +n); return `<span class="md-progress"><span class="bar"><span style="width:${v}%"></span></span><span class="small muted">${v}%</span></span>`; })
      .replace(/\[\[algo:([a-z0-9-]+)\]\]/g, (_, slug) => `<a href="#/algo/${slug}">${esc(problemBySlug[slug] ? plabel(problemBySlug[slug]) : slug)}</a>`)
      .replace(/\[\[([a-z0-9-]+)\]\]/g, (_, id) => `<a href="#/topic/${id}">${esc(topicById[id]?.title || id)}</a>`)
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|#|\/)[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/==([^=]+)==/g, '<mark>$1</mark>')
      // pills, same colours as the 刷题 difficulty badges: {{x}} purple, {{+x}} lime, {{!x}} pink, {{~x}} grey
      .replace(/\{\{([+!~]?)([^{}]+)\}\}/g, (_, k, t) => `<span class="pill pill-${{ '+': 'lime', '!': 'pink', '~': 'gray' }[k] || 'purple'}">${t}</span>`);
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  }

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
        out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      } else if ((m = /^:::(tip|warn|note|details|card|fold)\s*(.*)$/.exec(line))) {
        const buf = [];
        i++;
        while (i < lines.length && lines[i].trim() !== ':::') buf.push(lines[i++]);
        i++;
        const title = inline(m[2]);
        const body = markdown(buf.join('\n'));
        out.push(m[1] === 'details'
          ? `<details class="qa"><summary>${title}</summary><div class="qa-body">${body}</div></details>`
          : m[1] === 'fold'
            ? `<details class="md-fold"><summary><span>${title}</span><span class="muted small">点击展开</span></summary><div class="md-fold-body">${body}</div></details>`
            : m[1] === 'card'
              ? `<section class="md-card">${title ? `<div class="md-card-head">${title}</div>` : ''}${body}</section>`
              : `<div class="callout ${m[1]}">${title ? `<div class="callout-title">${title}</div>` : ''}${body}</div>`);
      } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        const level = m[1].length;
        out.push(`<h${level}${level === 2 ? ` id="sec-${++h2}"` : ''}>${inline(m[2])}</h${level}>`);
        i++;
      } else if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
        out.push('<hr>');
        i++;
      } else if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote>${markdown(buf.join('\n'))}</blockquote>`);
      } else if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
          rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      } else if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        }
        const tasks = items.every(it => /^\[[ xX]\]\s/.test(it));
        const lis = items.map(it => {
          const t = /^\[([ xX])\]\s(.*)$/.exec(it);
          return t ? `<li class="task ${t[1] === ' ' ? '' : 'checked'}"><span class="box">${t[1] === ' ' ? '' : '✓'}</span>${inline(t[2])}</li>` : `<li>${inline(it)}</li>`;
        }).join('');
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}${tasks ? ' class="tasks"' : ''}>${lis}</${tag}>`);
      } else if (!line.trim()) {
        i++;
      } else {
        const buf = [];
        while (i < lines.length && lines[i].trim() && !/^(```|:::|#{1,6}\s|>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) {
          buf.push(inline(lines[i++]));
        }
        out.push(`<p>${buf.join('<br>')}</p>`);
      }
    }
    return out.join('\n');
  }

  // ---------------------------------------------------------------- cute icons (inline SVG, colours from app.css)

  const FACE = 'fill="none" stroke="var(--face)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
  const eyes = (y, l = 10, r = 14) => `<circle cx="${l}" cy="${y}" r=".95" fill="var(--face)"/><circle cx="${r}" cy="${y}" r=".95" fill="var(--face)"/>`;
  const smile = (y, l = 10.6, r = 13.4) => `<path d="M${l} ${y}q${(r - l) / 2} 1.3 ${r - l} 0" ${FACE}/>`;
  const blush = (y, l = 7.6, r = 16.4) => `<ellipse cx="${l}" cy="${y}" rx="1.2" ry=".7" fill="var(--pink)" opacity=".55"/><ellipse cx="${r}" cy="${y}" rx="1.2" ry=".7" fill="var(--pink)" opacity=".55"/>`;
  const LINE = 'stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"';

  const ICONS = {
    // 小失误：叉叉眼 + 波浪嘴
    oops: `<circle cx="12" cy="12" r="9.5" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      <path d="M8.2 8.8l2 2M10.2 8.8l-2 2M13.8 8.8l2 2M15.8 8.8l-2 2" ${FACE}/>
      <path d="M9.2 15.6c.7-.8 1.3-.8 1.9 0s1.2.8 1.9 0 1.3-.8 1.9 0" ${FACE}/>${blush(13.2, 6.8, 17.2)}`,
    // 完成：眯眼笑
    happy: `<circle cx="12" cy="12" r="9.5" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
      <path d="M8.3 10.6q1.2-1.6 2.4 0M13.3 10.6q1.2-1.6 2.4 0" ${FACE} style="--face:var(--lime-ink)"/>
      <path d="M9.4 13.6q2.6 2.8 5.2 0" ${FACE} style="--face:var(--lime-ink)"/>${blush(13.3, 7, 17)}`,
    star: `<path d="M12 2.8l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.1l-5.2 2.8 1-5.8L3.5 9l5.9-.8z" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
      <g style="--face:var(--lime-ink)">${eyes(10.8, 10.4, 13.6)}${smile(12.9, 11, 13)}</g>`,
    flag: `<path d="M5.5 21V3.8" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M5.5 4.3h12.2l-2.6 4 2.6 4H5.5" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
      <g style="--face:var(--lime-ink)">${eyes(7.8, 9, 12)}${smile(9.6, 9.6, 11.4)}</g>`,
    bubble: `<path d="M7 4.5h10a4 4 0 0 1 4 4v4.5a4 4 0 0 1-4 4h-6.2L7 20v-3.1A4 4 0 0 1 3 13V8.5a4 4 0 0 1 4-4z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      ${eyes(10, 9.3, 14.7)}<circle cx="12" cy="13" r="1" fill="none" stroke="var(--face)" stroke-width="1.3"/>${blush(12, 6.8, 17.2)}`,
    flask: `<path d="M9.6 3.2h4.8M10.6 3.2v5.6L5.3 18.2a1.9 1.9 0 0 0 1.7 2.8h10a1.9 1.9 0 0 0 1.7-2.8L13.4 8.8V3.2" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <path d="M7.4 14.6h9.2l2.1 3.6a1.9 1.9 0 0 1-1.7 2.8H7a1.9 1.9 0 0 1-1.7-2.8z" fill="var(--lime)"/>
      <circle cx="11.3" cy="11.2" r=".8" fill="var(--accent)"/><circle cx="12.9" cy="8.9" r=".6" fill="var(--accent)"/>
      <g style="--face:var(--lime-ink)">${eyes(17.2, 10.2, 13.8)}${smile(18.7, 11.1, 12.9)}</g>`,
    book: `<rect x="4.5" y="3" width="14" height="18" rx="2.6" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <path d="M7.7 3.2v17.6" stroke="var(--accent)" stroke-width="1.4"/>
      <path d="M14 3v5l1.5-1.1L17 8V3" fill="var(--lime)" stroke="var(--lime-line)" stroke-width="1" stroke-linejoin="round"/>
      ${eyes(11.8, 11.2, 15)}${smile(14, 12.1, 14.1)}${blush(13.4, 10, 16.2)}`,
    pencil: `<path d="M15.2 4.8l4 4L9.4 18.6 4.6 19.4l.8-4.8z" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
      <path d="M15.2 4.8l1.3-1.3a1.6 1.6 0 0 1 2.3 0l1.7 1.7a1.6 1.6 0 0 1 0 2.3l-1.3 1.3z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      <path d="M5.4 14.6l4 4" stroke="var(--lime-line)" stroke-width="1.2"/>
      <g style="--face:var(--lime-ink)"><circle cx="10.6" cy="11.4" r=".85" fill="var(--face)"/><circle cx="12.6" cy="13.4" r=".85" fill="var(--face)"/></g>`,
    flame: `<path d="M12 21.2c-3.9 0-6.4-2.6-6.4-6 0-3.3 2.5-5.1 3.7-8.1.5 1.8 1.5 2.9 2.6 3.1-.3-2.6.8-5.1 2.9-7 .3 2.9 3.6 5.4 3.6 9.8 0 3.9-2.6 8.2-6.4 8.2z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      ${eyes(15, 10.3, 13.7)}${smile(17.1, 10.9, 13.1)}`,
    code: `<rect x="3.5" y="4" width="17" height="16" rx="4.5" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <path d="M8.2 9.2L6.4 11l1.8 1.8M15.8 9.2l1.8 1.8-1.8 1.8" fill="none" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      ${eyes(10.8, 10.4, 13.6)}${smile(13.6, 11, 13)}${blush(14.6, 8.4, 15.6)}`,
    heart: `<path d="M12 20s-7.6-4.6-7.6-10.1A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.6 2.5C19.6 15.4 12 20 12 20z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      ${eyes(11.6, 9.8, 14.2)}${smile(13.7, 11, 13)}`,
  };

  // more cute icons, mostly for notes (see EMOJI_ICONS below)
  Object.assign(ICONS, {
    calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="3.5" fill="var(--surface)" stroke="var(--accent)" ${LINE}/>
      <path d="M3.5 8.5a3.5 3.5 0 0 1 3.5-3.5h10a3.5 3.5 0 0 1 3.5 3.5V10h-17z" fill="var(--lime)" stroke="var(--accent)" ${LINE}/>
      <path d="M8 3.5v3M16 3.5v3" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/>
      ${eyes(14.3, 10.2, 13.8)}${smile(16.4, 10.8, 13.2)}${blush(16, 7.8, 16.2)}`,
    link: `<rect x="2.8" y="8.2" width="10.5" height="7.6" rx="3.8" fill="none" stroke="var(--accent)" stroke-width="2"/>
      <rect x="10.7" y="8.2" width="10.5" height="7.6" rx="3.8" fill="var(--lime)" fill-opacity=".55" stroke="var(--lime-line)" stroke-width="2"/>
      <g style="--face:var(--lime-ink)">${eyes(11.4, 15, 17.4)}${smile(13, 15.4, 17)}</g>`,
    bulb: `<path d="M12 2.8a6.6 6.6 0 0 0-3.9 11.9c.7.6 1.1 1.3 1.1 2.1v.7h5.6v-.7c0-.8.4-1.5 1.1-2.1A6.6 6.6 0 0 0 12 2.8z" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
      <path d="M9.6 19.4h4.8M10.3 21.2h3.4" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/>
      <g style="--face:var(--lime-ink)">${eyes(9.4, 10.3, 13.7)}${smile(11.6, 11, 13)}</g>${blush(11.2, 8.4, 15.6)}`,
    pin: `<path d="M12 14.5v7" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="12" cy="9" r="6.3" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      ${eyes(8.6, 10.3, 13.7)}${smile(10.8, 11, 13)}${blush(10.2, 7.9, 16.1)}`,
    target: `<circle cx="12" cy="12" r="9.3" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      <circle cx="12" cy="12" r="5.8" fill="var(--surface)" stroke="var(--pink)" stroke-width="1.3"/>
      ${eyes(11, 10.3, 13.7)}${smile(13.1, 11, 13)}`,
    chart: `<rect x="3" y="3.5" width="18" height="17" rx="4" fill="var(--surface)" stroke="var(--accent)" ${LINE}/>
      <rect x="6.3" y="12" width="3" height="5.5" rx="1.2" fill="var(--pink)"/>
      <rect x="10.5" y="8.5" width="3" height="9" rx="1.2" fill="var(--accent)"/>
      <rect x="14.7" y="6" width="3" height="11.5" rx="1.2" fill="var(--lime-line)"/>`,
    warn: `<path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.4 12.9a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      ${eyes(13.2, 10.3, 13.7)}<path d="M11 16.6q1-.9 2 0" ${FACE}/>${blush(15.4, 8.3, 15.7)}`,
    search: `<circle cx="10.2" cy="10.2" r="6.6" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <path d="M15 15l5.2 5.2" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round"/>
      ${eyes(9.4, 8.6, 11.8)}${smile(11.6, 9.2, 11.2)}`,
    bug: `<path d="M12 5.5v15M6.2 9.5l-2.4-1.4M17.8 9.5l2.4-1.4M5.8 14H3.2M18.2 14h2.6M6.4 18.2l-2 1.6M17.6 18.2l2 1.6" stroke="var(--face)" stroke-width="1.3" stroke-linecap="round"/>
      <ellipse cx="12" cy="13.8" rx="6.3" ry="7" fill="var(--pink)" stroke="var(--pink)" stroke-width="1.2"/>
      <path d="M12 7.2v13.5" stroke="var(--face)" stroke-width="1.1"/>
      <circle cx="9.2" cy="15.6" r="1.1" fill="var(--face)"/><circle cx="14.8" cy="15.6" r="1.1" fill="var(--face)"/>
      <circle cx="12" cy="6.4" r="3.4" fill="var(--pink-soft)" stroke="var(--pink)" stroke-width="1.2"/>
      <circle cx="10.8" cy="6.2" r=".7" fill="var(--face)"/><circle cx="13.2" cy="6.2" r=".7" fill="var(--face)"/>`,
    globe: `<circle cx="12" cy="12" r="9.3" fill="color-mix(in srgb, var(--lime) 45%, var(--surface))" stroke="var(--lime-line)" ${LINE}/>
      <path d="M2.9 12h18.2M12 2.7c2.6 2.6 3.8 5.7 3.8 9.3s-1.2 6.7-3.8 9.3M12 2.7C9.4 5.3 8.2 8.4 8.2 12s1.2 6.7 3.8 9.3" fill="none" stroke="var(--lime-line)" stroke-width="1.1"/>`,
    clock: `<circle cx="12" cy="12.5" r="8.8" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <path d="M12 7.6v5l3 1.8" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M9 2.6h6" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/>${blush(16.2, 7, 17)}`,
    shield: `<path d="M12 2.8l7.5 3v5.6c0 4.9-3.2 8.3-7.5 9.8-4.3-1.5-7.5-4.9-7.5-9.8V5.8z" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
      <g style="--face:var(--lime-ink)">${eyes(10.8, 10.2, 13.8)}${smile(13.4, 10.9, 13.1)}</g>${blush(12.6, 7.9, 16.1)}`,
    sword: `<path d="M18.8 3.2l2 2-10.3 10.3-2-2z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <path d="M6.2 13.4l4.4 4.4M8.6 15.8l-3.9 3.9" stroke="var(--pink)" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="4.2" cy="20.2" r="1.3" fill="var(--pink)"/>`,
    wrench: `<path d="M14.8 3.5a4.8 4.8 0 0 0-4.4 6.6l-6.6 6.6a1.9 1.9 0 0 0 2.7 2.7l6.6-6.6a4.8 4.8 0 0 0 6.6-4.4l-2.9 1.4-2.2-.6-.6-2.2z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <circle cx="5.4" cy="18.4" r=".9" fill="var(--accent)"/>`,
    question: `<path d="M7 4.5h10a4 4 0 0 1 4 4v4.5a4 4 0 0 1-4 4h-6.2L7 20v-3.1A4 4 0 0 1 3 13V8.5a4 4 0 0 1 4-4z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      <path d="M10.2 8.6a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.7-.8 1.3v.4" fill="none" stroke="var(--face)" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="12" cy="14.2" r=".9" fill="var(--face)"/>`,
    rocket: `<path d="M12 2.8c3.4 2.2 5 5.6 4.6 10.2l-2.3 2.8H9.7l-2.3-2.8C7 8.4 8.6 5 12 2.8z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <path d="M7.6 12.5L5 15.8l3.6-.3M16.4 12.5l2.6 3.3-3.6-.3" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      <path d="M10.4 17.6q1.6 3.4 3.2 0" fill="var(--lime)" stroke="var(--lime-line)" stroke-width="1.2"/>
      ${eyes(9.4, 10.6, 13.4)}${smile(11.4, 11.2, 12.8)}`,
    eye: `<path d="M2.8 12c2.4-4.2 5.5-6.3 9.2-6.3s6.8 2.1 9.2 6.3c-2.4 4.2-5.5 6.3-9.2 6.3S5.2 16.2 2.8 12z" fill="var(--surface)" stroke="var(--accent)" ${LINE}/>
      <circle cx="12" cy="12" r="3.6" fill="var(--accent)"/><circle cx="13.2" cy="10.8" r="1.1" fill="#fff"/>`,
    trash: `<path d="M5.5 7.5h13l-1.1 11.6a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      <path d="M4 7.5h16M9.5 7.5V5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2.3" fill="none" stroke="var(--pink)" stroke-width="1.5" stroke-linecap="round"/>
      ${eyes(12.8, 10.2, 13.8)}<path d="M11 16.2q1-.8 2 0" ${FACE}/>`,
    folder: `<path d="M3 7a2.2 2.2 0 0 1 2.2-2.2h4.3l2 2.2h7.3A2.2 2.2 0 0 1 21 9.2v8.6a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 17.8z" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
      <g style="--face:var(--lime-ink)">${eyes(13, 10.2, 13.8)}${smile(15.2, 11, 13)}</g>${blush(14.8, 7.8, 16.2)}`,
    tag: `<path d="M3.5 4.8v6.1a2 2 0 0 0 .6 1.4l8.3 8.3a2 2 0 0 0 2.8 0l5.4-5.4a2 2 0 0 0 0-2.8l-8.3-8.3a2 2 0 0 0-1.4-.6H4.8a1.3 1.3 0 0 0-1.3 1.3z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      <circle cx="7.8" cy="8.3" r="1.5" fill="var(--surface)" stroke="var(--pink)" stroke-width="1.2"/>
      ${eyes(13.4, 12.4, 15.2)}`,
    person: `<circle cx="12" cy="8.6" r="4.6" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <path d="M4.2 20.4c.6-4 3.8-6.6 7.8-6.6s7.2 2.6 7.8 6.6z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      ${eyes(8.5, 10.4, 13.6)}${smile(10.3, 11.1, 12.9)}`,
    house: `<path d="M3.8 11.2L12 4l8.2 7.2V19a1.8 1.8 0 0 1-1.8 1.8H5.6A1.8 1.8 0 0 1 3.8 19z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <rect x="10" y="15.4" width="4" height="5.4" rx="1" fill="var(--lime)" stroke="var(--lime-line)" stroke-width="1.2"/>
      ${eyes(11.4, 10, 14)}${smile(13, 11.1, 12.9)}`,
    cycle: `<path d="M19.5 10.2A7.8 7.8 0 0 0 5.4 7.4M4.5 13.8a7.8 7.8 0 0 0 14.1 2.8" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
      <path d="M5 3.8v3.9h3.9M19 20.2v-3.9h-3.9" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${eyes(11.3, 10.3, 13.7)}${smile(13.3, 11, 13)}`,
    battery: `<rect x="2.8" y="7" width="16" height="10.5" rx="3" fill="var(--surface)" stroke="var(--accent)" ${LINE}/>
      <rect x="4.6" y="8.8" width="9.4" height="6.9" rx="1.6" fill="var(--lime)"/>
      <path d="M20.6 10.3v3.9" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
      <g style="--face:var(--lime-ink)">${eyes(11.6, 7.8, 10.8)}${smile(13.6, 8.3, 10.3)}</g>`,
    compass: `<circle cx="12" cy="12" r="9.3" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <path d="M12 5.2l2.4 6.8H9.6z" fill="var(--pink)"/><path d="M12 18.8l-2.4-6.8h4.8z" fill="var(--surface)" stroke="var(--accent)" stroke-width=".9"/>
      <circle cx="12" cy="12" r="1.2" fill="var(--accent)"/>`,
    briefcase: `<rect x="3" y="7.5" width="18" height="12.5" rx="3" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
      <path d="M9 7.5V5.6a1.4 1.4 0 0 1 1.4-1.4h3.2A1.4 1.4 0 0 1 15 5.6v1.9" fill="none" stroke="var(--accent)" stroke-width="1.5"/>
      <rect x="10.4" y="11.2" width="3.2" height="2.2" rx=".6" fill="var(--lime)"/>
      ${eyes(15.6, 9.2, 14.8)}${smile(17.2, 11, 13)}`,
    dot: `<circle cx="12" cy="12" r="8.5" fill="var(--c, var(--lime))" stroke="var(--face)" stroke-opacity=".25" stroke-width="1"/>
      <g style="--face:#2b2140">${eyes(11, 10.2, 13.8)}${smile(13.4, 10.9, 13.1)}</g>`,
    cross: `<circle cx="12" cy="12" r="9.5" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
      <path d="M9 9l6 6M15 9l-6 6" stroke="var(--pink)" stroke-width="2.2" stroke-linecap="round"/>`,
  });

  // emoji → cute icon, applied to note text (never inside code)
  const EMOJI_ICONS = {
    '📘': 'book', '📖': 'book', '📚': 'book', '📄': 'book', '📗': 'book', '📕': 'book',
    '📅': 'calendar', '🗓': 'calendar', '📆': 'calendar',
    '⭐': 'star', '🌟': 'star', '🏆': 'star', '✨': 'star',
    '🔗': 'link', '💡': 'bulb', '📌': 'pin', '📍': 'pin', '🎯': 'target',
    '📊': 'chart', '📈': 'chart', '⚠': 'warn', '🚨': 'warn',
    '🔍': 'search', '🔎': 'search', '🐞': 'bug', '🐛': 'bug', '🌐': 'globe',
    '⏱': 'clock', '⏰': 'clock', '🕐': 'clock', '🧪': 'flask', '🔬': 'flask',
    '🧰': 'wrench', '🛠': 'wrench', '🔧': 'wrench', '🛡': 'shield', '🗡': 'sword', '⚔': 'sword',
    '🧠': 'bubble', '💬': 'bubble', '🗣': 'bubble', '❓': 'question', '🤔': 'question',
    '🧩': 'code', '💻': 'code', '👍': 'happy', '✅': 'happy', '😊': 'happy', '🎉': 'happy',
    '👎': 'oops', '😵': 'oops', '❌': 'cross', '🔋': 'battery', '🧭': 'compass',
    '💼': 'briefcase', '🏢': 'house', '🏠': 'house', '👤': 'person', '🙋': 'person',
    '🔁': 'cycle', '🔄': 'cycle', '📂': 'folder', '📁': 'folder', '🏷': 'tag',
    '✏': 'pencil', '📝': 'pencil', '✍': 'pencil', '🔤': 'pencil', '✂': 'pencil',
    '🚀': 'rocket', '👁': 'eye', '🗑': 'trash', '🔥': 'flame', '❤': 'heart', '💜': 'heart',
    '🟡': 'dot:#f5c542', '🟢': 'dot:var(--lime)', '🔴': 'dot:var(--pink)',
  };
  const EMOJI_RE = new RegExp(`(${Object.keys(EMOJI_ICONS).join('|')})\\uFE0F?`, 'gu');

  function cuteIconHtml(emoji) {
    const [name, color] = EMOJI_ICONS[emoji].split(':');
    return `<span class="emo" title="${emoji}"${color ? ` style="--c:${color}"` : ''}>${icon(name)}</span>`;
  }

  // walks text nodes under root (skipping code / pre / form fields) and swaps emoji for cute icons
  function cutify(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement.closest('pre, code, textarea, option, .emo')
        ? NodeFilter.FILTER_REJECT : (EMOJI_RE.lastIndex = 0, EMOJI_RE.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const span = document.createElement('span');
      span.innerHTML = esc(n.data).replace(EMOJI_RE, m => cuteIconHtml(m.replace(/\uFE0F/g, '')));
      n.replaceWith(...span.childNodes);
    }
  }

  const icon = (name, cls = '') =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

  // ---------------------------------------------------------------- shared view pieces

  const bar = p => `<div class="bar${p === 100 ? ' full' : ''}" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>`;

  function checklist(ids, labels, extra = () => '') {
    return `<ul class="checklist">${ids.map((id, i) => {
      const done = state.progress[id];
      return `<li class="${done ? 'done' : ''}">
        <input type="checkbox" id="c-${esc(id)}" data-item="${esc(id)}" ${done ? 'checked' : ''}>
        <label for="c-${esc(id)}">${labels[i]}${extra(i)}</label>
        ${done ? `<span class="date">${esc(done)}</span>` : ''}
      </li>`;
    }).join('')}</ul>`;
  }

  const resourceLabel = r => `<span class="type">${esc(r.type)}</span>` +
    (r.u ? `<a href="${esc(r.u)}" target="_blank" rel="noopener noreferrer">${esc(r.t)}</a>` : esc(r.t));

  function noteEditor(noteId, placeholder) {
    return `<div class="card" id="note-card" data-note="${esc(noteId)}">
      <div class="editor-bar">
        <h3 style="margin:0">笔记</h3><code class="small">study/notes/${esc(noteId)}.md</code>
        <span class="spacer"></span>
        <span class="save-state" id="save-state"></span>
        <button data-mode="edit">编辑</button><button data-mode="split" class="on">分栏</button><button data-mode="preview">预览</button>
        <button class="link" data-note-del title="删除这篇笔记">🗑</button>
      </div>
      <div class="editor split" id="editor">
        <textarea id="note-text" placeholder="${esc(placeholder)}" spellcheck="false"></textarea>
        <div class="preview md" id="note-preview"></div>
      </div>
      <p class="muted small">支持 Markdown，自动保存。扩展写法：<code>==高亮==</code>
        · 提示框 <code>:::tip 标题</code> / <code>:::warn</code> / <code>:::note</code> … <code>:::</code>
        · 折叠 <code>:::details 问题</code> … <code>:::</code>
        · 链接主题 <code>[[net-tcp]]</code> / 题目 <code>[[algo:two-sum]]</code></p>
    </div>`;
  }

  async function mountNoteEditor(template, { saveNow = false, onDelete, onSaved, mode } = {}) {
    const card = document.getElementById('note-card');
    if (!card) return;
    const id = card.dataset.note;
    const text = document.getElementById('note-text');
    const preview = document.getElementById('note-preview');
    const saveState = document.getElementById('save-state');
    const showPreview = () => { preview.innerHTML = markdown(text.value); cutify(preview); };
    const note = await api(`/notes/${id}`);
    text.value = note ? note.content : (template || '');
    showPreview();
    saveState.textContent = note ? `上次保存 ${new Date(note.updatedAt).toLocaleString()}` : '尚未保存';

    let timer;
    let dirty = false; // a template alone isn't worth a file, unless the user explicitly created the note
    const save = async () => {
      clearTimeout(timer);
      if (!dirty) return;
      dirty = false;
      try {
        await api(`/notes/${id}`, 'PUT', { content: text.value });
        saveState.textContent = `已保存 ${new Date().toLocaleTimeString()}`;
        onSaved?.();
      } catch (e) {
        dirty = true;
        saveState.textContent = '保存失败：' + e.message;
      }
    };
    text.addEventListener('input', () => {
      dirty = true;
      saveState.textContent = '编辑中…';
      showPreview();
      clearTimeout(timer);
      timer = setTimeout(save, 800);
    });
    text.addEventListener('blur', save);
    text.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
    });
    card.querySelector('[data-note-del]').addEventListener('click', async () => {
      clearTimeout(timer);
      dirty = false;
      if (!await deleteNote(id)) return;
      if (onDelete) { leaveHooks = []; onDelete(); return; }
      text.value = template || ''; // back to a fresh, unsaved template
      showPreview();
      saveState.textContent = '已删除，重新输入会新建';
    });
    card.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      card.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x === b));
      document.getElementById('editor').className = 'editor ' + b.dataset.mode;
      document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('on', (p.dataset.panel === 'view') === (b.dataset.mode === 'preview')));
      if (b.dataset.mode === 'edit') {
        const ta = document.getElementById('note-text');
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(0, 0); // start at the top, not wherever the caret landed
        ta.scrollTop = 0;
      }
    }));
    if (mode) card.querySelector(`[data-mode="${mode}"]`)?.click();
    leaveHooks.push(save);
    if (!note && saveNow) {
      dirty = true;
      save().then(async () => { state.notes = await api('/notes') || state.notes; });
    }
  }

  // ---------------------------------------------------------------- note templates (for new notes on the 笔记 page)

  function isoWeek(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const year = d.getUTCFullYear();
    return { year, week: Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7) };
  }

  const F = '```'; // a code fence can't be written literally inside a template literal
  // Templates follow the 刷题 pages: pill tags up top, a 关键点 box, cards, 易错点, 举一反三,
  // the "answer" part folded until you want it, and a closing 一句话记忆.
  const NOTE_TEMPLATES = {
    study: { label: '📘 学习笔记', body: t => `# 📘 ${t.title}

{{📅 ${t.date}}} {{~📚 讲义 / 课程 / 文章}} {{+⭐ 掌握 0/5}} {{🔗 [[主题id]]}}

## 题意：要搞懂什么

（用 2–3 句话写清楚：这次要学会的是什么、学完能回答什么问题）

:::tip 关键点
（学完后回来补：==一句话讲清它是什么、解决什么问题==）
:::

## 思路：核心概念

:::card ① 概念一 {{~待补充}}
- **是什么**：
- **为什么这样设计**：
- **例子**：
:::

:::card ② 概念二 {{~待补充}}
- **是什么**：
- **为什么这样设计**：
- **例子**：
:::

:::note 💡 类比
（用熟悉的东西类比，例如“Session 就像寄存柜的号码牌”）
:::

## 推演：原理 / 流程

${F}
Client ──▶ Server ──▶ DB        （英文画图，中文注释写在行尾）
${F}

## 动手实践

[[progress:0]]

- [ ] 实验 / 命令 1：
- [ ] 实验 / 命令 2：

${F}
$ 执行的命令
关键输出
${F}

## 攻防

| 视角 | 要点 | 在 Java / Spring 里 |
|---|---|---|
| {{!🗡 攻击}} | 怎么利用、前提条件、危害 |  |
| {{+🛡 防御}} | 代码 / 配置 / 检测 |  |

## 易错点

- 
- 

## 举一反三

- 相关主题：[[主题id]]
- 相关题目：[[algo:题目slug]]

:::fold ✅ 复习自测（先自己回答，再展开对照）
**Q1：** 

**A1：** 

**Q2：** 

**A2：** 
:::

## 一句话记忆

> （用一句话概括这次学到的套路，方便以后复习）
` },

    lab: { label: '🧪 实验记录', body: t => `# 🧪 实验：${t.title}

{{📅 ${t.date}}} {{~🧰 JDK 17 / Spring Boot / 本机}} {{🎯 [[主题id]]}} {{~📊 结果：待填}}

:::warn ⚠️ 授权声明
只在自己的环境或已授权的目标上做攻击实验。
:::

## 题意：实验目标

（这次要验证什么？预期结果是什么？）

## 环境准备

- [ ] 
- [ ] 

## 复现 {{!漏洞版}}

${F}
# 请求 / 命令
curl -v ...
${F}

${F}
# 响应 / 关键输出
${F}

:::tip 关键点：为什么能打穿
（根因：==哪一行代码 / 哪个配置==出了问题）
:::

## 修复 {{+修复版}}

${F}java
// 修复后的关键代码
${F}

## 验证

| 用例 | 漏洞版 | 修复版 |
|---|---|---|
| 正常请求 | {{~待测}} | {{~待测}} |
| 攻击请求 | {{~待测}} | {{~待测}} |
| 绕过尝试 | {{~待测}} | {{~待测}} |

## 易错点

- 

:::fold 🔍 追问：还能怎么绕过？（先自己想，再展开）
- 
:::

## 一句话记忆

> （用一句话概括这次学到的套路，方便以后复习）
` },

    debug: { label: '🐞 问题排查', body: t => `# 🐞 排查：${t.title}

{{📅 ${t.date}}} {{~🌐 开发 / 测试 / 生产}} {{!🚨 严重程度：高 / 中 / 低}} {{~⏱ 耗时：}} {{~📊 排查中}}

## 题意：现象

> （报错信息、影响范围、什么时候开始的）

${F}
错误日志 / 堆栈
${F}

## 思路：排查过程

| 步骤 | 做了什么 | 看到了什么 | 结论 |
|---|---|---|---|
| 1 |  |  | {{~待定}} |
| 2 |  |  | {{~待定}} |

:::note 🧠 当时的假设
- 假设 A：
- 假设 B：
:::

:::tip 关键点：根因
（不是“重启就好了”，而是==为什么会发生==）
:::

## 解决

${F}
修复代码 / 配置 / 命令
${F}

## 易错点：如何避免再次发生

- [ ] 监控 / 告警：
- [ ] 测试用例：
- [ ] 文档 / 规范：

## 举一反三

- 类似问题：
- 相关主题：[[主题id]]

## 一句话记忆

> （下次遇到类似问题，第一步先看什么）
` },

    weekly: { label: '🗓 周复盘', id: () => { const w = isoWeek(); return `weekly-${w.year}-${String(w.week).padStart(2, '0')}`; },
      body: t => `# 🗓 周复盘 · ${t.weekLabel}

{{📅 ${t.date}}} {{~⏱ __ 小时}} {{~📘 讲义 __ 篇}} {{~🧩 刷题 __ 道}} {{~🧪 实验 __ 个}}

## 本周进度

:::card 📘 学习路线
[[progress:0]]

- [ ] 
- [ ] 
:::

:::card 🧩 刷题
[[progress:0]]

| 题目 | 结果 | 卡在哪里 |
|---|---|---|
| [[algo:题目slug]] | {{+✅ 做出来}} / {{!😵 没做出}} |  |
:::

:::tip 关键点：本周最大的收获
（只写一件，写清楚==为什么重要==）
:::

## 复盘

| | 内容 |
|---|---|
| {{+👍 做得好}} |  |
| {{!👎 没做到}} |  |
| {{~🔋 状态}} | 专注 _/5 · 精力 _/5 · 心情 _/5 · 工作压力 _/5 |

## 下周计划（不超过 3 件）

- [ ] 
- [ ] 
- [ ] 

:::fold 🧭 对照原则（每周过一遍）
- 有没有同时学太多东西？
- 学的东西有没有落到项目 / 实验里？
- 离下一个节点还有多久，进度够吗？
:::

## 一句话记忆

> （用一句话总结这一周）
` },

    interview: { label: '💼 面试题整理', body: t => `# 💼 面试题：${t.title}

{{📅 ${t.date}}} {{~🏢 公司}} {{~👤 岗位}} {{~🔁 一面 / 二面}} {{中等}} {{~⭐ 当时表现 _/5}}

## 题意

> （面试官原话，尽量还原）

**考察点**：{{~待补充}} {{~待补充}}

:::tip 关键点：30 秒版回答
（先给结论，==一句话抓住核心==）
:::

:::fold 🗣 完整回答（2–3 分钟，先自己说一遍再展开）
1. **是什么**：
2. **为什么 / 原理**：
3. **项目里怎么用**（STAR：情境 → 任务 → 行动 → 结果）：
4. **常见坑与优化**：
:::

:::note 📂 我的项目例子
（汽车 / IoT / 电商里真实遇到过的场景）
:::

## 追问

:::details 追问 1：
回答：
:::

:::details 追问 2：
回答：
:::

## 易错点

- 

## 举一反三

- [[主题id]]
- [[algo:题目slug]]

## 一句话记忆

> （用一句话概括这次学到的套路，方便以后复习）
` },

    reading: { label: '📖 读书 / 文章笔记', body: t => `# 📖 ${t.title}

{{📅 ${t.date}}} {{~✍️ 作者}} {{~🏷 书 / 文章 / 视频 / 文档}} {{+⭐ 评分 _/5}}

## 题意：为什么读

## 核心观点

:::card ① 观点一
:::

:::card ② 观点二
:::

:::card ③ 观点三
:::

:::tip 关键点：如果只记住一句话
:::

## 原文摘录

> 

## 举一反三：能用到工作或项目里的

- [ ] 

:::fold 🤔 不同意 / 有疑问的地方
- 
:::

## 一句话记忆

> （用一句话概括这次学到的套路，方便以后复习）
` },

    blank: { label: '📄 空白', body: t => `# ${t.title}\n\n` },
  };

  function noteTemplate(kind, id) {
    const w = isoWeek();
    const t = { title: noteTitle(id), date: today(), weekLabel: `${w.year} 年第 ${w.week} 周` };
    return (NOTE_TEMPLATES[kind] || NOTE_TEMPLATES.study).body(t);
  }

  // ---------------------------------------------------------------- views

  function studyStreak() {
    const days = new Set(state.log.map(e => e.date));
    const d = new Date();
    if (!days.has(ymd(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function heatmap(weeks = 26) {
    const perDay = {};
    state.log.forEach(e => { perDay[e.date] = (perDay[e.date] || 0) + e.minutes; });
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (weeks * 7 - 1));
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // align to Monday
    const level = m => !m ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4;
    const cells = [];
    const t = today();
    for (const d = new Date(start); ymd(d) <= t || (d.getDay() + 6) % 7 !== 0; d.setDate(d.getDate() + 1)) {
      const k = ymd(d);
      const m = perDay[k] || 0;
      cells.push(k > t ? '<i class="future"></i>'
        : `<i data-l="${level(m)}" title="${k}：${m ? m + ' 分钟' : '未学习'}"></i>`);
    }
    return `<div class="heatmap" aria-label="过去 ${weeks} 周每日学习时长">${cells.join('')}</div>
      <div class="heat-legend">少 <i style="background:var(--heat-0)"></i><i style="background:var(--heat-1)"></i><i style="background:var(--heat-2)"></i><i style="background:var(--heat-3)"></i><i style="background:var(--heat-4)"></i> 多
      <span class="spacer"></span>&lt;30 / 30–60 / 60–120 / 120+ 分钟</div>`;
  }

  function viewDashboard() {
    const all = stats(topics.flatMap(topicItems));
    const knowledge = stats(topics.flatMap(t => t.points.map((_, i) => `${t.id}:k${i}`)));
    const projects = stats(C.projects.flatMap(projectItems));
    const totalMin = state.log.reduce((a, e) => a + e.minutes, 0);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    const weekMin = state.log.filter(e => e.date >= ymd(weekAgo)).reduce((a, e) => a + e.minutes, 0);
    const cur = currentStage();
    const next = nextTopic();
    const algo = algoStats();
    setTimeout(() => cutify(document.getElementById('recent-notes')));
    const cp = C.checkpoints.find(c => c.date >= today());
    const cpDays = cp ? Math.ceil((new Date(cp.date) - new Date(today())) / 86400000) : 0;

    return `
      <h1>仪表盘</h1>
      <p class="muted">${esc(C.mission)}</p>

      <div class="grid tiles" style="margin-top:18px">
        <div class="card tile"><div class="label">总进度</div><div class="value">${all.pct}%</div><div class="sub">${all.done} / ${all.total} 项</div></div>
        <div class="card tile"><div class="label">知识点</div><div class="value">${knowledge.done}</div><div class="sub">共 ${knowledge.total} 个</div></div>
        <div class="card tile"><div class="label">项目里程碑</div><div class="value">${projects.done}</div><div class="sub">共 ${projects.total} 个</div></div>
        <div class="card tile"><div class="label">累计学习</div><div class="value">${hours(totalMin)}<small style="font-size:14px"> 小时</small></div><div class="sub">近 7 天 ${weekMin} 分钟</div></div>
        <div class="card tile"><div class="label with-ico">${icon('code')}刷题</div><div class="value">${algo.solved}<small style="font-size:14px"> / ${algo.all.length}</small></div><div class="sub"><a href="#/algo">${algo.due.length ? `今日待复习 ${algo.due.length} 题 →` : '去刷题 →'}</a></div></div>
        <div class="card tile"><div class="label with-ico">${icon('flame')}连续打卡</div><div class="value">${studyStreak()}<small style="font-size:14px"> 天</small></div><div class="sub"><a href="#/journal">去打卡 →</a></div></div>
      </div>

      <div class="grid two" style="margin-top:16px">
        <div class="card">
          <h3>当前阶段：${esc(cur.title)} <span class="badge">${esc(cur.from)} ~ ${esc(cur.to)}</span></h3>
          <p class="small" style="color:var(--text-2)">${esc(cur.goal)}</p>
          ${next ? `<p>下一个未完成主题：<a href="#/topic/${next.id}"><strong>${esc(next.title)}</strong></a>
            <span class="muted small">（${esc(next.stage.title)} · 计划 ${esc(next.month)} · ${topicStats(next).pct}%）</span></p>` : `<p>${icon('happy')} 全部主题已完成</p>`}
          ${cp ? `<p class="small muted">下一个节点：<a href="#/principles">${esc(cp.title)}</a>（${esc(cp.date)}，还有 ${cpDays} 天）</p>` : ''}
        </div>
        <div class="card">
          <h3>过去 26 周学习热力图</h3>
          ${heatmap()}
        </div>
      </div>

      <h2>各阶段进度</h2>
      <div class="card">
        ${C.stages.map(s => {
          const st = stageStats(s);
          return `<div class="stage-row">
            <a href="#/roadmap/${s.id}">${esc(s.title)}${s === cur ? '<span class="badge">当前</span>' : ''}</a>
            ${bar(st.pct)}
            <span class="pct">${st.pct}% · ${st.done}/${st.total}</span>
          </div>`;
        }).join('')}
      </div>

      <h2>最近的笔记</h2>
      <div class="card" id="recent-notes">
        ${state.notes.slice(0, 6).map(n => `<a class="note-item" href="${noteHref(n.id)}">
          <div class="row">${kindPill(n.id)}<strong>${esc(noteTitle(n.id))}</strong><span class="spacer"></span>
          <span class="muted small">${new Date(n.updatedAt).toLocaleString()} · ${n.length} 字</span></div>
          <div class="muted small md">${inline(cleanExcerpt(n.excerpt))}</div></a>`).join('') || '<p class="muted">还没有笔记。打开任意一个主题开始写吧。</p>'}
        ${state.notes.length > 6 ? '<p class="small" style="margin:10px 0 0"><a href="#/notes">查看全部笔记 →</a></p>' : ''}
      </div>`;
  }

  function viewRoadmap(stageId) {
    const cur = currentStage();
    setTimeout(() => stageId && document.getElementById('stage-' + stageId)?.scrollIntoView({ behavior: 'smooth' }));
    return `
      <h1>路线图</h1>
      <p class="muted">${esc(C.identity)}</p>
      <div style="margin-top:18px">
      ${C.stages.map((s, n) => {
        const st = stageStats(s);
        return `<section class="card stage ${s === cur ? 'current' : ''}" id="stage-${s.id}">
          <div class="stage-head">
            <h2 style="margin:0">S${n + 1} · ${esc(s.title)}</h2>
            <span class="period">${esc(s.from)} ~ ${esc(s.to)}</span>
            ${s === cur ? '<span class="badge">当前阶段</span>' : ''}
            <span class="spacer"></span><span class="small muted">${st.done}/${st.total} · ${st.pct}%</span>
          </div>
          <p class="small with-ico" style="color:var(--text-2);margin:6px 0 10px">${icon('star')}<span>${esc(s.goal)}</span></p>
          ${bar(st.pct)}
          <div class="topic-list">
            ${s.topics.map(t => {
              const ts = topicStats(t);
              return `<a class="topic-chip" href="#/topic/${t.id}">
                <strong>${esc(t.title)}</strong>${ts.pct === 100 ? ` <span class="badge good">${icon('happy')}完成</span>` : ''}
                <div class="meta"><span>计划 ${esc(t.month)}</span><span>${ts.done}/${ts.total}</span></div>
                ${bar(ts.pct)}
              </a>`;
            }).join('')}
          </div>
        </section>`;
      }).join('')}
      </div>`;
  }

  // section: optional "sec-N" from #/topic/<id>/sec-N, scrolled to once the lesson has rendered
  async function mountLesson(t, section) {
    const body = document.getElementById('lesson-body');
    if (!body) return;
    const res = await fetch(`lessons/${t.id}.md`);
    if (!res.ok) {
      body.innerHTML = '<p class="muted">这篇讲义还在编写中。先看下面的知识点、实践和权威资料吧。</p>';
      return;
    }
    const src = await res.text();
    body.innerHTML = markdown(src);
    const chars = src.replace(/\s/g, '').length;
    document.getElementById('lesson-meta').textContent = `约 ${Math.round(chars / 100) / 10} 千字 · 阅读约 ${Math.max(1, Math.round(chars / 400))} 分钟`;
    const toc = document.getElementById('lesson-toc');
    toc.innerHTML = [...body.querySelectorAll('h2[id]')]
      .map(h => `<button class="link" data-sec="${h.id}">${esc(h.textContent)}</button>`).join('');
    toc.addEventListener('click', e => {
      const id = e.target.dataset?.sec;
      if (id) document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (section && /^sec-\d+$/.test(section)) document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }

  function viewTopic(id, section) {
    const t = topicById[id];
    if (!t) return `<h1>找不到主题</h1><p><a href="#/roadmap">返回路线图</a></p>`;
    const idx = topics.indexOf(t);
    const prev = topics[idx - 1], next = topics[idx + 1];
    const ts = topicStats(t);
    const kIds = t.points.map((_, i) => `${t.id}:k${i}`);
    const pIds = (t.practice || []).map((_, i) => `${t.id}:p${i}`);
    const rIds = (t.resources || []).map((_, i) => `${t.id}:r${i}`);

    const template = `# ${t.title}\n\n## 用自己的话讲清楚\n\n\n## 在请求链路 / 系统里的位置\n\n\n## 攻击者会怎么想\n\n${
      (t.questions || []).map(q => `- ${q}\n  - `).join('\n')}\n\n## 在 Java / Spring 里怎么防\n\n\n## 实验记录\n\n\n## 还没搞懂的\n\n`;

    setTimeout(() => { mountNoteEditor(template); mountLesson(t, section); });
    return `
      <div class="crumbs"><a href="#/roadmap/${t.stage.id}">${esc(t.stage.title)}</a> · 计划 ${esc(t.month)}${t.lab ? ` · 对应实验笔记 <code>docs/labs/${esc(t.lab)}</code>` : ''}</div>
      <div class="row"><h1>${esc(t.title)}</h1><span class="spacer"></span><span class="muted small">${ts.done}/${ts.total} · ${ts.pct}%</span></div>
      ${bar(ts.pct)}
      <p class="summary">${esc(t.summary)}</p>

      <details class="card lesson" id="lesson" open>
        <summary><span class="with-ico">${icon('book')}讲义</span><span class="muted small" id="lesson-meta"></span></summary>
        <nav class="toc" id="lesson-toc"></nav>
        <div class="md lesson-body" id="lesson-body"><p class="muted">加载中…</p></div>
        <div class="lesson-done">${checklist([lessonItem(t)], ['我已读完这篇讲义，并能用自己的话讲出来'])}</div>
      </details>

      <div class="grid two" style="margin-top:18px">
        <div class="card"><h3>知识点</h3>${checklist(kIds, t.points.map(esc))}</div>
        <div class="card">
          <h3 class="with-ico">${icon('bubble')}攻击者视角：思考题</h3>
          <ul class="questions">${(t.questions || []).map(q => `<li>${esc(q)}</li>`).join('')}</ul>
          <h3 class="with-ico" style="margin-top:14px">${icon('flask')}动手实践</h3>
          ${checklist(pIds, (t.practice || []).map(esc))}
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h3 class="with-ico">${icon('book')}权威资料 <span class="muted small">（读完 / 做完后勾选）</span></h3>
        ${checklist(rIds, (t.resources || []).map(resourceLabel))}
      </div>

      <div style="margin-top:16px">${noteEditor(t.id, '写下你的理解…')}</div>

      <div class="pager">
        <span>${prev ? `← <a href="#/topic/${prev.id}">${esc(prev.title)}</a>` : ''}</span>
        <span>${next ? `<a href="#/topic/${next.id}">${esc(next.title)}</a> →` : ''}</span>
      </div>`;
  }

  function viewProjects(projectId) {
    if (projectId) {
      const p = C.projects.find(x => x.id === projectId);
      if (!p) return '<h1>找不到项目</h1>';
      const st = stats(projectItems(p));
      setTimeout(() => mountNoteEditor(`# ${p.title}\n\n## 架构图\n\n\n## 设计决策\n\n\n## 踩坑记录\n\n\n## 简历描述（STAR）\n\n`));
      return `
        <div class="crumbs"><a href="#/projects">项目</a> · ${esc(p.period)}</div>
        <div class="row"><h1>${esc(p.title)}</h1><span class="spacer"></span><span class="muted small">${st.done}/${st.total} · ${st.pct}%</span></div>
        ${bar(st.pct)}
        <p class="summary">技术栈：${esc(p.stack)}${p.link ? `<br>位置：${esc(p.link)}` : ''}</p>
        <div class="card" style="margin-top:16px"><h3>里程碑</h3>${checklist(projectItems(p), p.milestones.map(esc))}</div>
        <div style="margin-top:16px">${noteEditor(`project-${p.id}`, '项目设计与记录…')}</div>`;
    }
    return `
      <h1>项目</h1>
      <p class="muted">不要只看课程：每个阶段都用一个项目把知识落地。项目 > 课程 > 证书。</p>
      <div class="grid two" style="margin-top:18px">
        ${C.projects.map(p => {
          const st = stats(projectItems(p));
          return `<a class="card topic-chip" href="#/projects/${p.id}">
            <h3>${esc(p.title)}</h3>
            <div class="meta"><span>${esc(p.period)}</span><span>${st.done}/${st.total}</span></div>
            <p class="small muted" style="margin:0 0 10px">${esc(p.stack)}</p>
            ${bar(st.pct)}
          </a>`;
        }).join('')}
      </div>`;
  }

  const diffBadge = d => `<span class="diff diff-${d}">${DIFF[d]}</span>`;
  const statusChip = st => `<span class="st st-${st.state}">${st.label}${st.due && st.state !== 'due' ? ` · ${st.due.slice(5)}` : ''}</span>`;

  function viewAlgo() {
    const set = setById[algoSet] || ALGO.sets[0];
    const { all, solved, mastered } = algoStats(set.id);
    const due = algoStats().due; // today's reviews span every set
    const byDiff = d => `${all.filter(x => x.p.diff === d && x.st.solved).length}/${all.filter(x => x.p.diff === d).length}`;
    setTimeout(() => {
      const apply = () => {
        const q = document.getElementById('aq').value.trim().toLowerCase();
        const df = document.getElementById('adiff').value;
        const sf = document.getElementById('astate').value;
        let n = 0;
        document.querySelectorAll('#algo-list tr[data-slug]').forEach(tr => {
          const show = (!q || tr.dataset.q.includes(q)) && (!df || tr.dataset.diff === df) && (!sf || tr.dataset.state === sf);
          tr.hidden = !show;
          if (show) n++;
        });
        document.querySelectorAll('#algo-list .algo-cat').forEach(c => { c.hidden = !c.querySelector('tr[data-slug]:not([hidden])'); });
        document.getElementById('acount').textContent = `${n} 题`;
      };
      document.querySelectorAll('.filters input, .filters select').forEach(el => el.addEventListener('input', apply));
      document.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => {
        algoSet = b.dataset.set;
        localStorage.setItem('algoSet', algoSet);
        render();
      }));
      apply();
    });
    return `
      <h1>刷题</h1>
      <div class="set-tabs">${ALGO.sets.map(x => `<button data-set="${x.id}" class="${x.id === set.id ? 'on' : ''}">${esc(x.title)}
        <span class="muted small">${algoStats(x.id).solved}/${ALGO.problems.filter(p => p.set === x.id).length}</span></button>`).join('')}</div>
      <p class="muted">${esc(set.desc)} 题意为自己转述，有题号的点“力扣 ↗”去官网提交判题。</p>

      <div class="grid tiles" style="margin-top:18px">
        <div class="card tile"><div class="label">做出来</div><div class="value">${solved}<small style="font-size:14px"> / ${all.length}</small></div><div class="sub">简单 ${byDiff('E')} · 中等 ${byDiff('M')} · 困难 ${byDiff('H')}</div></div>
        <div class="card tile"><div class="label">今日待复习</div><div class="value">${due.length}</div><div class="sub">做错的次日重做，做对的按 ${ALGO.review.join('/')} 天复习</div></div>
        <div class="card tile"><div class="label">已掌握</div><div class="value">${mastered}</div><div class="sub">连续 ${ALGO.review.length + 1} 次做对</div></div>
      </div>

      ${due.length ? `<div class="card" style="margin-top:16px"><h3 class="with-ico">${icon('flame')}今日待复习</h3>
        <div class="due-list">${due.map(({ p, st }) => `<a class="due-chip" href="#/algo/${p.slug}">${esc(plabel(p))} <span class="muted small">${st.label}</span></a>`).join('')}</div></div>` : ''}

      <div class="filters" style="margin-top:18px">
        <input type="search" id="aq" placeholder="搜索题号或标题…" style="min-width:220px">
        <select id="adiff"><option value="">全部难度</option><option value="E">简单</option><option value="M">中等</option><option value="H">困难</option></select>
        <select id="astate"><option value="">全部状态</option><option value="new">未做</option><option value="due">今日该做</option><option value="retry">待重做</option><option value="learning">复习中</option><option value="mastered">已掌握</option></select>
        <span class="muted small" id="acount" style="align-self:center"></span>
      </div>

      <div id="algo-list">
        ${set.categories.map(c => {
          const rows = all.filter(x => x.p.cat === c.id);
          const done = rows.filter(x => x.st.solved).length;
          return `<section class="card algo-cat" style="margin-bottom:14px">
            <div class="row"><h3 style="margin:0">${esc(c.title)}</h3><span class="spacer"></span><span class="muted small">${done}/${rows.length}</span></div>
            <div style="margin:8px 0 6px">${bar(pct(done, rows.length))}</div>
            <table class="data algo-table"><tbody>
              ${rows.map(({ p, st }) => `<tr data-slug="${p.slug}" data-diff="${p.diff}" data-state="${st.state}" data-q="${esc((p.no + ' ' + p.title + ' ' + p.slug).toLowerCase())}">
                <td class="num muted" style="width:52px">${p.no ?? '—'}</td>
                <td><a href="#/algo/${p.slug}">${esc(p.title)}</a></td>
                <td style="width:64px">${diffBadge(p.diff)}</td>
                <td style="width:150px">${statusChip(st)}</td>
                <td style="width:56px">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" class="small">力扣 ↗</a>` : '<span class="muted small">手写</span>'}</td>
              </tr>`).join('')}
            </tbody></table>
          </section>`;
        }).join('')}
      </div>`;
  }

  async function mountSolution(p) {
    const box = document.getElementById('solution');
    if (!box) return;
    const res = await fetch(`algo/${p.slug}.md`);
    if (!res.ok) {
      box.innerHTML = '<p class="muted">这道题的题解还在编写中，先去力扣做题吧。</p>';
      return;
    }
    const md = await res.text();
    const cut = md.indexOf('\n## 思路');
    box.innerHTML = cut < 0 ? `<div class="md lesson-body">${markdown(md)}</div>` : `
      <div class="md lesson-body">${markdown(md.slice(0, cut))}</div>
      <details class="card lesson spoiler">
        <summary><span class="with-ico">${icon('bubble')}思路与题解</span><span class="muted small">先自己想 15～20 分钟，卡住了再展开</span></summary>
        <div class="md lesson-body">${markdown(md.slice(cut))}</div>
      </details>`;
  }

  function viewAlgoProblem(slug) {
    const p = problemBySlug[slug];
    if (!p) return '<h1>找不到这道题</h1><p><a href="#/algo">返回题单</a></p>';
    const st = algoStatus(slug);
    const inSet = ALGO.problems.filter(x => x.set === p.set);
    const idx = inSet.indexOf(p);
    const prev = inSet[idx - 1], next = inSet[idx + 1];
    const cat = catOf(p);
    setTimeout(() => {
      mountSolution(p);
      mountNoteEditor(`# ${plabel(p)}\n\n## 我的第一反应\n\n\n## 卡在哪里\n\n\n## 关键点\n\n`);
      document.querySelectorAll('[data-attempt]').forEach(b => b.addEventListener('click', async () => {
        try {
          await api('/algo', 'POST', { slug, result: b.dataset.attempt });
          state.attempts = await api('/algo') || [];
          toast(b.dataset.attempt === 'ac' ? '已记录：做出来了 ✓' : '已记录，明天再做一遍');
          render();
        } catch (err) { toast('记录失败：' + err.message); }
      }));
      document.querySelectorAll('[data-del-attempt]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('删除这条做题记录？')) return;
        await api(`/algo/${b.dataset.delAttempt}`, 'DELETE');
        state.attempts = await api('/algo') || [];
        render();
      }));
    });
    return `
      <div class="crumbs"><a href="#/algo">刷题</a> · ${esc(setById[p.set].title)} · ${esc(cat.title)}</div>
      <div class="row"><h1>${esc(plabel(p))}</h1>${diffBadge(p.diff)}<span class="spacer"></span>${statusChip(st)}</div>

      <div class="card row algo-actions" style="margin-top:14px">
        ${p.url ? `<a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">去力扣做题 ↗</a>`
          : '<span class="small muted">手写题：先在 IDE 里自己写一遍并跑通，再展开对照题解</span>'}
        <span class="spacer"></span>
        <span class="muted small">做完记录一下：</span>
        <button class="primary" data-attempt="ac">✅ 做出来了</button>
        <button data-attempt="fail">😵 没做出来 / 看了题解</button>
      </div>
      ${st.tries.length ? `<p class="small muted" style="margin:8px 2px">做题记录：${st.tries.map(a =>
        `<span class="attempt">${a.date.slice(5)} ${a.result === 'ac' ? '✅' : '😵'}<button class="link" data-del-attempt="${a.index}" aria-label="删除">✕</button></span>`).join('')}
        ${st.due ? ` · 下次：${st.due}` : ''}</p>` : ''}

      <div class="card" id="solution" style="margin-top:16px"><p class="muted">加载中…</p></div>

      <div style="margin-top:16px">${noteEditor(`algo-${p.slug}`, '记录你的解题过程…')}</div>

      <div class="pager">
        <span>${prev ? `← <a href="#/algo/${prev.slug}">${esc(plabel(prev))}</a>` : ''}</span>
        <span>${next ? `<a href="#/algo/${next.slug}">${esc(plabel(next))}</a> →` : ''}</span>
      </div>`;
  }

  function viewResources() {
    const all = topics.flatMap(t => (t.resources || []).map((r, i) => ({ ...r, id: `${t.id}:r${i}`, topic: t })));
    const types = [...new Set(all.map(r => r.type))];
    const rows = all.map(r => `<tr data-type="${esc(r.type)}" data-stage="${r.topic.stage.id}"
        data-done="${state.progress[r.id] ? 1 : 0}" data-q="${esc((r.t + ' ' + r.topic.title).toLowerCase())}">
      <td><input type="checkbox" data-item="${esc(r.id)}" ${state.progress[r.id] ? 'checked' : ''} aria-label="已读"></td>
      <td>${resourceLabel(r)}</td>
      <td><a href="#/topic/${r.topic.id}">${esc(r.topic.title)}</a></td>
      <td class="muted small">${esc(r.topic.stage.title)}</td>
    </tr>`).join('');
    setTimeout(() => {
      const apply = () => {
        const q = document.getElementById('rq').value.trim().toLowerCase();
        const ty = document.getElementById('rtype').value;
        const sg = document.getElementById('rstage').value;
        const dn = document.getElementById('rdone').value;
        let n = 0;
        document.querySelectorAll('#rtable tbody tr').forEach(tr => {
          const show = (!q || tr.dataset.q.includes(q)) && (!ty || tr.dataset.type === ty)
            && (!sg || tr.dataset.stage === sg) && (!dn || tr.dataset.done === dn);
          tr.hidden = !show;
          if (show) n++;
        });
        document.getElementById('rcount').textContent = `${n} 条`;
      };
      document.querySelectorAll('.filters input, .filters select').forEach(el => el.addEventListener('input', apply));
      apply();
    });
    const read = all.filter(r => state.progress[r.id]).length;
    return `
      <h1>资料库</h1>
      <p class="muted">全部 ${all.length} 条资料，已读 ${read} 条。优先级：规范 / 官方文档 / 权威标准（OWASP、NIST、RFC）&gt; 靶场 &gt; 教程。</p>
      <div class="filters" style="margin-top:14px">
        <input type="search" id="rq" placeholder="搜索标题或主题…" style="min-width:240px">
        <select id="rtype"><option value="">全部类型</option>${types.map(t => `<option>${esc(t)}</option>`).join('')}</select>
        <select id="rstage"><option value="">全部阶段</option>${C.stages.map(s => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select>
        <select id="rdone"><option value="">全部</option><option value="0">未读</option><option value="1">已读</option></select>
        <span class="muted small" id="rcount" style="align-self:center"></span>
      </div>
      <div class="card"><table class="data" id="rtable">
        <thead><tr><th style="width:30px"></th><th>资料</th><th>主题</th><th>阶段</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  // ---- note kinds: where a note belongs decides its title, link and whether it may be renamed ----

  const NOTE_KINDS = {
    free: { label: '自由笔记', pill: 'purple' },
    topic: { label: '主题笔记', pill: 'lime' },
    project: { label: '项目笔记', pill: 'purple' },
    algo: { label: '刷题笔记', pill: 'purple' },
    review: { label: '复盘', pill: 'pink' },
  };

  function noteKind(id) {
    if (topicById[id]) return 'topic';
    if (id.startsWith('algo-') && problemBySlug[id.slice(5)]) return 'algo';
    if (C.projects.some(x => `project-${x.id}` === id)) return 'project';
    if (C.checkpoints.some(x => x.note === id) || id.startsWith('weekly-')) return 'review';
    return 'free';
  }

  function noteHref(id) {
    const kind = noteKind(id);
    if (kind === 'topic') return `#/topic/${id}`;
    if (kind === 'algo') return `#/algo/${id.slice(5)}`;
    if (kind === 'project') return `#/projects/${id.slice(8)}`;
    return `#/notes/${id}`;
  }

  // topic / problem / project notes are tied to their id; only free-standing notes can be renamed
  const renamable = id => ['free', 'review'].includes(noteKind(id)) && !C.checkpoints.some(x => x.note === id);

  function noteTitle(id) {
    if (topicById[id]) return topicById[id].title;
    const algoP = id.startsWith('algo-') && problemBySlug[id.slice(5)];
    if (algoP) return `刷题：${plabel(algoP)}`;
    const p = C.projects.find(x => `project-${x.id}` === id);
    if (p) return p.title;
    const cp = C.checkpoints.find(x => x.note === id);
    if (cp) return cp.title;
    return state.notes.find(n => n.id === id)?.title || id;
  }

  const kindPill = id => { const k = NOTE_KINDS[noteKind(id)]; return `<span class="pill pill-${k.pill}">${k.label}</span>`; };

  // server excerpts are cut at 80 chars; drop a pill that got cut in half
  const cleanExcerpt = t => (t || '').replace(/\{\{[^}]*…$/, '…');

  function highlight(text, q) {
    const safe = esc(text);
    if (!q) return safe;
    const re = new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return safe.replace(re, m => `<mark>${m}</mark>`);
  }

  async function renameNote(id) {
    const newId = prompt(`把笔记「${noteTitle(id)}」的 id 改成：\n（只能用小写字母、数字和 -）`, id)?.trim().toLowerCase();
    if (!newId || newId === id) return null;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(newId)) { toast('只能用小写字母、数字和 -'); return null; }
    try {
      await api(`/notes/${id}/rename`, 'POST', { newId });
    } catch (e) {
      toast(e.message.includes('409') ? '这个 id 已经被占用了' : '重命名失败：' + e.message);
      return null;
    }
    state.notes = await api('/notes') || [];
    toast('已重命名');
    return newId;
  }

  async function deleteNote(id) {
    if (!confirm(`删除笔记「${noteTitle(id)}」？\n（文件会从 study/notes 删除；提交过的话可以从 git 恢复）`)) return false;
    await api(`/notes/${id}`, 'DELETE');
    state.notes = await api('/notes') || [];
    toast('已删除');
    return true;
  }

  // ---- 笔记 page: list on the left (查) with 查看/编辑/重命名/删除 on every row, the selected note on the right ----

  const noteUi = { q: '', kind: '', sort: 'updated', scroll: 0 };

  function noteRow(n, q, selected) {
    const body = n.snippet ? highlight(n.snippet, q) : n.excerpt ? inline(cleanExcerpt(n.excerpt)) : '（空笔记）';
    const id = esc(n.id);
    return `<div class="note-item ${selected ? 'selected' : ''}" data-id="${id}">
      <a class="note-main" href="#/notes/${id}">
        <div class="row">${kindPill(n.id)}<strong>${highlight(noteTitle(n.id), q)}</strong></div>
        <div class="muted small note-snippet md">${body}</div>
        <div class="muted small note-meta"><code>${highlight(n.id, q)}</code> · ${new Date(n.updatedAt).toLocaleString()} · ${n.length} 字</div>
      </a>
      <div class="note-actions">
        <a href="#/notes/${id}">查看</a>
        <button class="link" data-edit="${id}">编辑</button>
        ${renamable(n.id) ? `<button class="link" data-rename="${id}">重命名</button>` : ''}
        <button class="link danger" data-del="${id}">删除</button>
      </div>
    </div>`;
  }

  async function refreshNoteList(selected) {
    const box = document.getElementById('note-list');
    if (!box) return;
    const q = noteUi.q;
    let list = q ? await api(`/notes?q=${encodeURIComponent(q)}`) || [] : state.notes;
    if (noteUi.kind) list = list.filter(n => noteKind(n.id) === noteUi.kind);
    const by = {
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      title: (a, b) => noteTitle(a.id).localeCompare(noteTitle(b.id), 'zh'),
      length: (a, b) => b.length - a.length,
    }[noteUi.sort];
    list = [...list].sort(by);
    document.getElementById('ncount').textContent = q ? `找到 ${list.length} 篇` : `共 ${list.length} 篇`;
    box.innerHTML = list.map(n => noteRow(n, q, n.id === selected)).join('')
      || `<p class="muted" style="padding:12px 4px">${q ? '没有找到包含这个关键词的笔记。' : '还没有笔记，用上面的模板新建一篇吧。'}</p>`;
    cutify(box);
    box.scrollTop = noteUi.scroll;
  }

  function notePanel(id) {
    if (!id) {
      return `<div class="card note-empty">
        <p style="font-size:34px;margin:0">📝</p>
        <p><strong>选一篇笔记查看或编辑</strong></p>
        <p class="muted small">左边列表里每篇笔记都可以 查看 / 编辑 / 重命名 / 删除；<br>也可以在上方用模板新建一篇。</p>
      </div>`;
    }
    const kind = noteKind(id);
    const home = kind === 'free' || kind === 'review' ? '' : `<a class="small" href="${noteHref(id)}">打开所在页面 ↗</a>`;
    return `
      <div class="card note-head">
        <div class="row">${kindPill(id)}<h2 style="margin:0;font-size:19px">${esc(noteTitle(id))}</h2></div>
        <div class="muted small" style="margin-top:4px"><code>study/notes/${esc(id)}.md</code> · <span id="panel-save"></span></div>
        <div class="row note-buttons" style="margin-top:12px">
          <button data-panel="view">👁 查看</button>
          <button data-panel="edit">✏️ 编辑</button>
          ${renamable(id) ? '<button id="ren-note">🔤 重命名</button>' : ''}
          <button class="danger" id="del-note">🗑 删除</button>
          ${home}
        </div>
      </div>
      <div style="margin-top:12px">${noteEditor(id, '')}</div>`;
  }

  function viewNotes(selected) {
    const counts = Object.fromEntries(Object.keys(NOTE_KINDS).map(k => [k, state.notes.filter(n => noteKind(n.id) === k).length]));
    setTimeout(() => {
      const list = document.getElementById('note-list');
      let timer;
      document.getElementById('nq').addEventListener('input', e => {
        clearTimeout(timer);
        timer = setTimeout(() => { noteUi.q = e.target.value.trim(); noteUi.scroll = 0; refreshNoteList(selected); }, 250);
      });
      document.getElementById('nkind').addEventListener('change', e => { noteUi.kind = e.target.value; refreshNoteList(selected); });
      document.getElementById('nsort').addEventListener('change', e => { noteUi.sort = e.target.value; refreshNoteList(selected); });
      list.addEventListener('scroll', () => { noteUi.scroll = list.scrollTop; });
      list.addEventListener('click', async e => {
        const edit = e.target.closest('[data-edit]'), ren = e.target.closest('[data-rename]'), del = e.target.closest('[data-del]');
        if (edit) {
          sessionStorage.setItem('noteMode', 'edit');
          if (edit.dataset.edit === selected) render(); else location.hash = `#/notes/${edit.dataset.edit}`;
        }
        if (ren) {
          const newId = await renameNote(ren.dataset.rename);
          if (newId && ren.dataset.rename === selected) location.hash = `#/notes/${newId}`;
          else if (newId) refreshNoteList(selected);
        }
        if (del && await deleteNote(del.dataset.del)) {
          if (del.dataset.del === selected) location.hash = '#/notes'; else refreshNoteList(selected);
        }
      });
      document.getElementById('new-note').addEventListener('submit', e => {
        e.preventDefault();
        const id = document.getElementById('new-id').value.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) { toast('只能用小写字母、数字和 -'); return; }
        if (state.notes.some(n => n.id === id)) toast('这个 id 已经有笔记了，直接打开');
        else sessionStorage.setItem('noteTpl', document.getElementById('new-tpl').value);
        sessionStorage.setItem('noteMode', 'edit');
        location.hash = `#/notes/${id}`;
      });
      document.querySelectorAll('[data-tpl]').forEach(b => b.addEventListener('click', () => {
        document.querySelectorAll('[data-tpl]').forEach(x => x.classList.toggle('on', x === b));
        document.getElementById('new-tpl').value = b.dataset.tpl;
        const tpl = NOTE_TEMPLATES[b.dataset.tpl];
        const input = document.getElementById('new-id');
        if (tpl.id && !input.value) input.value = tpl.id();
        input.focus();
      }));
      refreshNoteList(selected);
      cutify(document.querySelector('.note-head'));
      cutify(document.querySelector('.tpl-chips'));
      if (selected) mountNotePanel(selected);
    });
    return `
      <h1>笔记</h1>
      <p class="muted">所有笔记都在这里 新建 / 查看 / 编辑 / 重命名 / 删除 / 搜索；文件保存在 <code>study/notes/*.md</code>。</p>

      <form id="new-note" class="card row" style="margin-top:16px">
        <strong style="width:100%">＋ 新建笔记 <span class="muted small" style="font-weight:400">选一个模板，填上 id</span></strong>
        <input type="hidden" id="new-tpl" value="study">
        <div class="tpl-chips">${Object.entries(NOTE_TEMPLATES).map(([k, v], i) =>
          `<button type="button" data-tpl="${k}" class="${i ? '' : 'on'}">${esc(v.label)}</button>`).join('')}</div>
        <input type="text" id="new-id" placeholder="笔记 id，如 spring-security-filter" required style="flex:1;min-width:200px">
        <button class="primary">新建并编辑</button>
      </form>

      <div class="notes-layout">
        <section>
          <div class="filters note-filters">
            <input type="search" id="nq" placeholder="🔍 全文搜索：标题、id、正文" value="${esc(noteUi.q)}">
            <select id="nkind"><option value="">全部类型</option>${Object.entries(NOTE_KINDS).map(([k, v]) =>
              `<option value="${k}" ${noteUi.kind === k ? 'selected' : ''}>${v.label}（${counts[k]}）</option>`).join('')}</select>
            <select id="nsort">${[['updated', '最近更新'], ['title', '按标题'], ['length', '按字数']].map(([k, v]) =>
              `<option value="${k}" ${noteUi.sort === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <span class="muted small" id="ncount"></span>
          </div>
          <div class="card" id="note-list"><p class="muted">加载中…</p></div>
        </section>
        <section id="note-panel">${notePanel(selected)}</section>
      </div>`;
  }

  function mountNotePanel(id) {
    const chosen = sessionStorage.getItem('noteTpl'); // set only by 新建
    const mode = sessionStorage.getItem('noteMode') || 'preview';
    sessionStorage.removeItem('noteTpl');
    sessionStorage.removeItem('noteMode');
    const kind = noteKind(id);
    const template = kind === 'free' || kind === 'review' ? noteTemplate(chosen || 'study', id) : '';
    mountNoteEditor(template, {
      saveNow: !!chosen,
      mode,
      onDelete: () => { location.hash = '#/notes'; },
      onSaved: async () => { state.notes = await api('/notes') || state.notes; refreshNoteList(id); },
    });
    const setMode = m => document.querySelector(`#note-card [data-mode="${m}"]`)?.click();
    document.querySelector('[data-panel="view"]').addEventListener('click', () => setMode('preview'));
    document.querySelector('[data-panel="edit"]').addEventListener('click', () => setMode('edit'));
    // mirror the editor's save status into the panel header (the editor's own bar is hidden here)
    const status = document.getElementById('save-state'), mirror = document.getElementById('panel-save');
    const sync = () => { mirror.textContent = status.textContent; };
    new MutationObserver(sync).observe(status, { childList: true, characterData: true, subtree: true });
    sync();
    document.getElementById('del-note').addEventListener('click', () => document.querySelector('#note-card [data-note-del]').click());
    document.getElementById('ren-note')?.addEventListener('click', async () => {
      for (const save of leaveHooks) await save(); // flush pending edits before the file moves
      leaveHooks = [];
      const newId = await renameNote(id);
      if (newId) location.hash = `#/notes/${newId}`; else render();
    });
  }

  // old #/note/<id> links (e.g. checkpoint 复盘 notes) now open inside the 笔记 page
  function viewNote(id) {
    location.replace(noteHref(id));
    return '';
  }

  function viewJournal() {
    const byTopic = {};
    state.log.forEach(e => { byTopic[e.topicId] = (byTopic[e.topicId] || 0) + e.minutes; });
    const topicRows = Object.entries(byTopic).sort((a, b) => b[1] - a[1]);
    setTimeout(() => {
      document.getElementById('log-form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target;
        try {
          await api('/log', 'POST', { date: f.date.value, minutes: +f.minutes.value, topicId: f.topic.value, text: f.text.value });
          state.log = await api('/log');
          toast('已打卡 ✓');
          render();
        } catch (err) { toast('打卡失败：' + err.message); }
      });
      document.querySelectorAll('[data-del-log]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('删除这条记录？')) return;
        await api(`/log/${b.dataset.delLog}`, 'DELETE');
        state.log = await api('/log');
        render();
      }));
    });
    const cur = nextTopic();
    return `
      <h1>学习日志</h1>
      <p class="muted">每天花了多少时间、学了什么。保存在 <code>study/log.tsv</code>。</p>
      <form class="card row" id="log-form" style="margin-top:16px">
        <input type="date" name="date" value="${today()}" required>
        <input type="number" name="minutes" min="1" max="1440" value="60" required style="width:90px"> 分钟
        <select name="topic"><option value="">（不关联主题）</option>
          ${C.stages.map(s => `<optgroup label="${esc(s.title)}">${s.topics.map(t =>
            `<option value="${t.id}" ${cur === t ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</optgroup>`).join('')}
        </select>
        <input type="text" name="text" placeholder="今天学了什么 / 做了哪个实验" style="flex:1;min-width:220px">
        <button class="primary">打卡</button>
      </form>

      <div class="grid two" style="margin-top:16px">
        <div class="card"><h3>学习热力图</h3>${heatmap(26)}</div>
        <div class="card"><h3>按主题累计</h3>
          <table class="data"><thead><tr><th>主题</th><th style="text-align:right">时长</th></tr></thead><tbody>
          ${topicRows.map(([id, m]) => `<tr><td>${topicById[id] ? `<a href="#/topic/${id}">${esc(topicById[id].title)}</a>` : '<span class="muted">未关联</span>'}</td>
            <td class="num">${hours(m)} h</td></tr>`).join('') || '<tr><td colspan="2" class="muted">暂无记录</td></tr>'}
          </tbody></table>
        </div>
      </div>

      <h2>记录</h2>
      <div class="card"><table class="data">
        <thead><tr><th>日期</th><th style="text-align:right">分钟</th><th>主题</th><th>内容</th><th></th></tr></thead>
        <tbody>${[...state.log].reverse().map(e => `<tr>
          <td>${esc(e.date)}</td><td class="num">${e.minutes}</td>
          <td>${topicById[e.topicId] ? `<a href="#/topic/${e.topicId}">${esc(topicById[e.topicId].title)}</a>` : '<span class="muted">-</span>'}</td>
          <td>${esc(e.text)}</td><td><button class="link" data-del-log="${e.index}" aria-label="删除">✕</button></td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">还没有记录，今天就开始吧。</td></tr>'}</tbody>
      </table></div>`;
  }

  function viewPrinciples() {
    return `
      <h1>原则与复盘</h1>
      <div class="card" style="margin-top:16px">
        <h3>主线</h3>
        <p style="margin:0">${esc(C.mission)}</p>
        <p class="muted small">目标身份：${esc(C.identity)}</p>
        <p class="muted small" style="margin-bottom:0">要解决的不是“AI 更新这么快我该学什么”，而是“我要建立什么样的底层能力，让 AI 每一次进步都能帮我，而不是让我重新学一遍”。</p>
      </div>

      <h2>关键节点</h2>
      <div class="grid two">
        ${C.checkpoints.map(c => {
          const days = Math.ceil((new Date(c.date) - new Date(today())) / 86400000);
          return `<div class="card">
            <h3>${esc(c.title)}</h3>
            <div class="muted small">${esc(c.date)} · ${days >= 0 ? `还有 ${days} 天` : '已到期'}</div>
            <p class="small" style="color:var(--text-2)">${esc(c.detail)}</p>
            <a href="#/note/${c.note}">写复盘笔记 →</a>
          </div>`;
        }).join('')}
      </div>

      <h2>容易犯的错误</h2>
      <div class="card">${C.pitfalls.map(p => `<div class="pitfall with-ico">${icon('oops', 'lg')}<span>${esc(p)}</span></div>`).join('')}</div>

      <div class="grid two" style="margin-top:16px">
        <div class="card">
          <h3>可以关注的岗位</h3>
          <p>${C.careers.map(c => `<span class="badge gray" style="margin:0 6px 6px 0">${esc(c)}</span>`).join('')}</p>
          <p class="muted small" style="margin:0">路径：在职学习 → 公司内部找安全相关的活 → 做安全项目 → 把 Java + 安全写进简历 → 尝试安全相关岗位。不要裸辞。</p>
        </div>
        <div class="card">
          <h3>证书（不是主线，按目标岗位再决定）</h3>
          <table class="data"><tbody>${C.certs.map(c => `<tr><td><a href="${esc(c.u)}" target="_blank" rel="noopener noreferrer">${esc(c.t)}</a></td>
            <td class="muted small">${esc(c.when)}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- router

  let leaveHooks = [];

  const NAV_ICONS = { dashboard: 'star', roadmap: 'flag', projects: 'flask', algo: 'code', resources: 'book', notes: 'pencil', journal: 'flame', principles: 'heart' };
  document.querySelectorAll('#nav a').forEach(a => a.insertAdjacentHTML('afterbegin', icon(NAV_ICONS[a.dataset.view])));

  function render() {
    leaveHooks.forEach(fn => fn());
    leaveHooks = [];
    const [view = 'dashboard', arg, sub] = location.hash.replace(/^#\/?/, '').split('/');
    const views = {
      dashboard: viewDashboard, roadmap: viewRoadmap, topic: viewTopic, projects: viewProjects,
      algo: slug => (slug ? viewAlgoProblem(slug) : viewAlgo()),
      resources: viewResources, notes: id => viewNotes(id), note: viewNote, journal: viewJournal, principles: viewPrinciples,
    };
    const navView = { topic: 'roadmap', note: 'notes' }[view] || view;
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === navView));
    main.innerHTML = (views[view] || viewDashboard)(arg && decodeURIComponent(arg), sub);
  }

  // checkbox → progress (works on every view)
  main.addEventListener('change', async e => {
    const id = e.target.dataset?.item;
    if (!id) return;
    const done = e.target.checked;
    try {
      state.progress = await api(`/progress/${encodeURIComponent(id)}`, 'PUT', { done });
      const li = e.target.closest('li');
      if (li) {
        li.classList.toggle('done', done);
        li.querySelector('.date')?.remove();
        if (done) li.insertAdjacentHTML('beforeend', `<span class="date">${esc(state.progress[id])}</span>`);
      }
      const tr = e.target.closest('tr');
      if (tr) tr.dataset.done = done ? 1 : 0;
      refreshBars();
    } catch (err) {
      e.target.checked = !done;
      toast('保存失败：' + err.message);
    }
  });

  // update the page's progress headline without re-rendering (keeps the note editor untouched)
  function refreshBars() {
    const [view, arg] = location.hash.replace(/^#\/?/, '').split('/');
    let st;
    if (view === 'topic' && topicById[arg]) st = topicStats(topicById[arg]);
    else if (view === 'projects' && arg) st = stats(projectItems(C.projects.find(p => p.id === arg)));
    else if (view !== 'resources') { render(); return; }
    if (!st) return;
    const b = main.querySelector('.bar > span');
    if (b) {
      b.style.width = st.pct + '%';
      b.parentElement.classList.toggle('full', st.pct === 100);
    }
    const label = main.querySelector('.row .muted.small');
    if (label) label.textContent = `${st.done}/${st.total} · ${st.pct}%`;
    if (st.pct === 100) toast('🎉 完成了一个主题！');
  }

  window.addEventListener('hashchange', async () => {
    if (/^#\/?(dashboard|notes)?$/.test(location.hash)) state.notes = await api('/notes') || [];
    render();
    window.scrollTo(0, 0);
  });
  window.addEventListener('beforeunload', () => leaveHooks.forEach(fn => fn()));

  Promise.all([api('/progress'), api('/log'), api('/notes'), api('/algo')])
    .then(([progress, log, notes, attempts]) => {
      Object.assign(state, { progress: progress || {}, log: log || [], notes: notes || [], attempts: attempts || [] });
      render();
    })
    .catch(err => { main.innerHTML = `<h1>无法连接后端</h1><p class="muted">${esc(err.message)}：请先 <code>./mvnw spring-boot:run</code></p>`; });
})();
