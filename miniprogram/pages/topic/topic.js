const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');
const api = require('../../utils/api');
const { markdown, toc } = require('../../utils/markdown');
const { toast } = require('../../utils/util');

const checks = (ids, labels, extra = () => ({})) =>
  ids.map((id, i) => ({ id, label: labels[i], done: store.S.progress[id] || '', ...extra(i) }));

page({
  share() {
    const t = store.topicById[this.id];
    return { title: t ? `${t.title} · 讲义` : '学习路线 · 讲义', query: `id=${this.id}` };
  },
  data: { lessonOpen: true, lesson: null },
  onLoad(o) { this.id = o.id; this.sec = o.sec; },
  render() {
    const t = store.topicById[this.id];
    if (!t) { this.setData({ missing: true }); return; }
    const stage = store.stageOf(t.id);
    const idx = store.topics.indexOf(t);
    const prev = store.topics[idx - 1], next = store.topics[idx + 1];
    const res = t.resources || [];
    if (!this.titled) {
      this.titled = true;
      wx.setNavigationBarTitle({ title: t.title });
      this.setData({
        template: `# ${t.title}\n\n## 用自己的话讲清楚\n\n\n## 在请求链路 / 系统里的位置\n\n\n## 攻击者会怎么想\n\n${
          (t.questions || []).map(q => `- ${q}\n  - `).join('\n')}\n\n## 在 Java / Spring 里怎么防\n\n\n## 实验记录\n\n\n## 还没搞懂的\n\n`,
      });
      this.loadLesson(t);
    }
    this.setData({
      t: { id: t.id, title: t.title, month: t.month, lab: t.lab || '', summary: t.summary, questions: t.questions || [] },
      stage: { id: stage.id, title: stage.title },
      st: store.topicStats(t),
      lessonItems: checks([store.lessonItem(t)], ['我已读完这篇讲义，并能用自己的话讲出来']),
      kItems: checks(t.points.map((_, i) => `${t.id}:k${i}`), t.points),
      pItems: checks((t.practice || []).map((_, i) => `${t.id}:p${i}`), t.practice || []),
      rItems: checks(res.map((_, i) => `${t.id}:r${i}`), res.map(r => r.t), i => ({ type: res[i].type, url: res[i].u || '' })),
      prev: prev ? { id: prev.id, title: prev.title } : null,
      next: next ? { id: next.id, title: next.title } : null,
    });
  },
  async loadLesson(t) {
    let src;
    try { src = await api.text(`lessons/${t.id}.md`); } catch (e) { src = null; }
    if (src == null) { this.setData({ lesson: { missing: true } }); return; }
    const blocks = markdown(src);
    const chars = src.replace(/\s/g, '').length;
    this.setData({
      lesson: { blocks, toc: toc(blocks), meta: `约 ${Math.round(chars / 100) / 10} 千字 · 阅读约 ${Math.max(1, Math.round(chars / 400))} 分钟` },
    }, () => {
      if (this.sec && /^sec-\d+$/.test(this.sec)) setTimeout(() => this.scrollTo(this.sec), 300);
    });
  },
  scrollTo(id) {
    const lesson = this.selectComponent('#lesson');
    if (lesson) lesson.scrollToId(id);
  },
  tapToc(e) { this.scrollTo(e.currentTarget.dataset.sec); },
  toggleLesson() { this.setData({ lessonOpen: !this.data.lessonOpen }); },
  // a box was ticked: refresh the headline without touching the note editor
  onCheck() {
    const st = store.topicStats(store.topicById[this.id]);
    this.setData({ st });
    if (st.pct === 100) toast('🎉 完成了一个主题！');
  },
  go(e) { nav.go(e.currentTarget.dataset.h); },
  turn(e) { nav.go(e.currentTarget.dataset.h, true); },
});
