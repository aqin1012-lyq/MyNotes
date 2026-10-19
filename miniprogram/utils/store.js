/* App state + everything derived from it, ported from the web app (src/main/resources/static/app.js). */
const api = require('./api');
const { today, thisMonth, pct, ymd, addDays, isoWeek } = require('./util');
const { NOTE_TEMPLATES } = require('./templates');

const S = { C: null, ALGO: null, progress: {}, log: [], notes: [], attempts: [] };
let topics = [], topicById = {}, stageOf = {}, problemBySlug = {}, setById = {};
let loading = null;

function index() {
  topics = [];
  stageOf = {};
  S.C.stages.forEach(stage => stage.topics.forEach(t => { stageOf[t.id] = stage; topics.push(t); }));
  topicById = Object.fromEntries(topics.map(t => [t.id, t]));
  problemBySlug = Object.fromEntries(S.ALGO.problems.map(p => [p.slug, p]));
  setById = Object.fromEntries(S.ALGO.sets.map(x => [x.id, x]));
}

// curriculum + data, fetched once; force re-fetches (e.g. after changing the backend address)
function load(force) {
  if (loading && !force) return loading;
  loading = Promise.all([
    api.json('curriculum.json'), api.json('algo.json'),
    api.study('/progress'), api.study('/log'), api.study('/notes'), api.study('/algo'),
  ]).then(([C, ALGO, progress, log, notes, attempts]) => {
    Object.assign(S, { C, ALGO, progress: progress || {}, log: log || [], notes: notes || [], attempts: attempts || [] });
    index();
    return S;
  }).catch(e => { loading = null; throw e; });
  return loading;
}

const refreshNotes = async () => { S.notes = await api.study('/notes') || S.notes; return S.notes; };
const refreshLog = async () => { S.log = await api.study('/log') || []; };
const refreshAttempts = async () => { S.attempts = await api.study('/algo') || []; };

async function setProgress(id, done) {
  S.progress = await api.study(`/progress/${encodeURIComponent(id)}`, 'PUT', { done });
  return S.progress;
}

// ---------------------------------------------------------------- curriculum

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
  const done = ids.filter(id => S.progress[id]).length;
  return { done, total: ids.length, pct: pct(done, ids.length) };
}
const topicStats = t => stats(topicItems(t));
const stageStats = s => stats(s.topics.flatMap(topicItems));

function currentStage() {
  const m = thisMonth();
  const stages = S.C.stages;
  return stages.find(s => s.from <= m && m <= s.to)
    || (m < stages[0].from ? stages[0] : stages.find(s => stageStats(s).pct < 100) || stages[stages.length - 1]);
}

const nextTopic = () => topics.find(t => topicStats(t).pct < 100);

// ---------------------------------------------------------------- algorithm practice

const DIFF = { E: '简单', M: '中等', H: '困难' };
const catOf = p => setById[p.set].categories.find(c => c.id === p.cat);
const plabel = p => (p.no ? `${p.no}. ` : '') + p.title;

// new → (fail) retry next day → (ac) review after 1/3/7/14/30/60 days of consecutive successes → mastered
function algoStatus(slug) {
  const tries = S.attempts.filter(a => a.slug === slug);
  if (!tries.length) return { state: 'new', label: '未做', tries };
  const last = tries[tries.length - 1];
  const solved = tries.some(a => a.result === 'ac');
  if (last.result === 'fail') {
    const due = addDays(last.date, 1);
    return { state: due <= today() ? 'due' : 'retry', label: '待重做', due, tries, solved };
  }
  let streak = 0;
  for (let i = tries.length - 1; i >= 0 && tries[i].result === 'ac'; i--) streak++;
  const review = S.ALGO.review;
  if (streak > review.length) return { state: 'mastered', label: '已掌握', tries, solved };
  const due = addDays(last.date, review[streak - 1]);
  return { state: due <= today() ? 'due' : 'learning', label: due <= today() ? '该复习了' : '复习中', due, tries, solved, streak };
}

function algoStats(setId) {
  const all = S.ALGO.problems.filter(p => !setId || p.set === setId).map(p => ({ p, st: algoStatus(p.slug) }));
  return {
    all,
    solved: all.filter(x => x.st.solved).length,
    due: all.filter(x => x.st.state === 'due'),
    mastered: all.filter(x => x.st.state === 'mastered').length,
  };
}

// "未做" / "复习中 · 10-20", as on the web
const statusText = st => st.label + (st.due && st.state !== 'due' ? ` · ${st.due.slice(5)}` : '');

// ---------------------------------------------------------------- journal

function studyStreak() {
  const days = new Set(S.log.map(e => e.date));
  const d = new Date();
  if (!days.has(ymd(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// columns of 7 days (Mon → Sun), oldest first
function heatmap(weeks = 26) {
  const perDay = {};
  S.log.forEach(e => { perDay[e.date] = (perDay[e.date] || 0) + e.minutes; });
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // align to Monday
  const level = m => !m ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4;
  const cols = [];
  const t = today();
  for (const d = new Date(start); ymd(d) <= t || (d.getDay() + 6) % 7 !== 0; d.setDate(d.getDate() + 1)) {
    const k = ymd(d);
    const m = perDay[k] || 0;
    if ((d.getDay() + 6) % 7 === 0) cols.push([]);
    cols[cols.length - 1].push(k > t ? { k, future: true } : { k, l: level(m), m });
  }
  return cols;
}

// ---------------------------------------------------------------- notes

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
  if (S.C.projects.some(x => `project-${x.id}` === id)) return 'project';
  if (S.C.checkpoints.some(x => x.note === id) || id.startsWith('weekly-')) return 'review';
  return 'free';
}

// the web's noteHref, as a link the md / nav helpers understand
function noteHref(id) {
  const kind = noteKind(id);
  if (kind === 'topic') return `#/topic/${id}`;
  if (kind === 'algo') return `#/algo/${id.slice(5)}`;
  if (kind === 'project') return `#/projects/${id.slice(8)}`;
  return `#/notes/${id}`;
}

// topic / problem / project notes are tied to their id; only free-standing notes can be renamed
const renamable = id => ['free', 'review'].includes(noteKind(id)) && !S.C.checkpoints.some(x => x.note === id);

function noteTitle(id) {
  if (topicById[id]) return topicById[id].title;
  const algoP = id.startsWith('algo-') && problemBySlug[id.slice(5)];
  if (algoP) return `刷题：${plabel(algoP)}`;
  const p = S.C.projects.find(x => `project-${x.id}` === id);
  if (p) return p.title;
  const cp = S.C.checkpoints.find(x => x.note === id);
  if (cp) return cp.title;
  const n = S.notes.find(x => x.id === id);
  return (n && n.title) || id;
}

const kindPill = id => { const k = NOTE_KINDS[noteKind(id)]; return { label: k.label, pill: k.pill }; };

// server excerpts are cut at 80 chars; drop a pill that got cut in half
const cleanExcerpt = t => (t || '').replace(/\{\{[^}]*…$/, '…');

function noteTemplate(kind, id) {
  const w = isoWeek();
  const t = { title: noteTitle(id), date: today(), weekLabel: `${w.year} 年第 ${w.week} 周` };
  return (NOTE_TEMPLATES[kind] || NOTE_TEMPLATES.study).body(t);
}

const NOTE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

module.exports = {
  S, load, refreshNotes, refreshLog, refreshAttempts, setProgress,
  get topics() { return topics; }, get topicById() { return topicById; }, get problemBySlug() { return problemBySlug; },
  get setById() { return setById; }, stageOf: id => stageOf[id],
  lessonItem, topicItems, projectItems, stats, topicStats, stageStats, currentStage, nextTopic,
  DIFF, catOf, plabel, algoStatus, algoStats, statusText,
  studyStreak, heatmap,
  NOTE_KINDS, NOTE_TEMPLATES, NOTE_ID_RE, noteKind, noteHref, renamable, noteTitle, kindPill, cleanExcerpt, noteTemplate,
};
