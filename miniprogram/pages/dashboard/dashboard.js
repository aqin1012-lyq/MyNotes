const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');
const md = require('../../utils/markdown');
const { ymd, today, hours, daysUntil, dateTime } = require('../../utils/util');

page({
  async render() {
    this.draw();
    await store.refreshNotes(); // as the web does when opening 仪表盘
    this.draw();
  },
  draw() {
    const { S, topics, topicItems, stats, stageStats, topicStats } = store;
    const C = S.C;
    const all = stats(topics.flatMap(topicItems));
    const knowledge = stats(topics.flatMap(t => t.points.map((_, i) => `${t.id}:k${i}`)));
    const projects = stats(C.projects.flatMap(store.projectItems));
    const totalMin = S.log.reduce((a, e) => a + e.minutes, 0);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    const weekMin = S.log.filter(e => e.date >= ymd(weekAgo)).reduce((a, e) => a + e.minutes, 0);
    const cur = store.currentStage();
    const next = store.nextTopic();
    const algo = store.algoStats();
    const cp = C.checkpoints.find(c => c.date >= today());
    this.setData({
      mission: C.mission,
      all, knowledge, projects,
      hours: hours(totalMin), weekMin,
      algo: { solved: algo.solved, total: algo.all.length, due: algo.due.length },
      streak: store.studyStreak(),
      cur: { title: cur.title, from: cur.from, to: cur.to, goal: cur.goal },
      next: next ? { id: next.id, title: next.title, stage: store.stageOf(next.id).title, month: next.month, pct: topicStats(next).pct } : null,
      cp: cp ? { title: cp.title, date: cp.date, days: daysUntil(cp.date) } : null,
      heat: store.heatmap(),
      stages: C.stages.map(s => ({ id: s.id, title: s.title, cur: s === cur, ...stageStats(s) })),
      notes: S.notes.slice(0, 6).map(n => ({
        id: n.id, kind: store.kindPill(n.id), title: md.emo(store.noteTitle(n.id)),
        time: dateTime(n.updatedAt), length: n.length, excerpt: md.inline(store.cleanExcerpt(n.excerpt)),
      })),
      moreNotes: S.notes.length > 6,
    });
  },
  go(e) { nav.go(e.currentTarget.dataset.h); },
  openNote(e) { nav.go(store.noteHref(e.currentTarget.dataset.id)); },
});
