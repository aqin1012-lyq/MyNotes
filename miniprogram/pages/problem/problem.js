const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');
const api = require('../../utils/api');
const { markdown } = require('../../utils/markdown');
const { toast, confirm } = require('../../utils/util');

page({
  share() {
    const p = store.problemBySlug[this.slug];
    return { title: p ? `刷题：${store.plabel(p)}` : '刷题', query: `slug=${this.slug}` };
  },
  data: { spoiler: false, solution: null },
  onLoad(o) { this.slug = o.slug; },
  render() {
    const p = store.problemBySlug[this.slug];
    if (!p) { this.setData({ missing: true }); return; }
    if (!this.titled) {
      this.titled = true;
      wx.setNavigationBarTitle({ title: store.plabel(p) });
      this.setData({ template: `# ${store.plabel(p)}\n\n## 我的第一反应\n\n\n## 卡在哪里\n\n\n## 关键点\n\n` });
      this.loadSolution(p);
    }
    const st = store.algoStatus(this.slug);
    const inSet = store.S.ALGO.problems.filter(x => x.set === p.set);
    const idx = inSet.indexOf(p);
    const prev = inSet[idx - 1], next = inSet[idx + 1];
    this.setData({
      p: { slug: p.slug, label: store.plabel(p), diff: p.diff, diffLabel: store.DIFF[p.diff], url: p.url || '' },
      crumbs: `${store.setById[p.set].title} · ${store.catOf(p).title}`,
      st: { state: st.state, text: store.statusText(st), due: st.due || '' },
      tries: st.tries.map(a => ({ index: a.index, date: a.date.slice(5), ok: a.result === 'ac' })),
      prev: prev ? { slug: prev.slug, label: store.plabel(prev) } : null,
      next: next ? { slug: next.slug, label: store.plabel(next) } : null,
    });
  },
  async loadSolution(p) {
    let src;
    try { src = await api.text(`algo/${p.slug}.md`); } catch (e) { src = null; }
    if (src == null) { this.setData({ solution: { missing: true } }); return; }
    const cut = src.indexOf('\n## 思路');
    this.setData({
      solution: cut < 0 ? { head: markdown(src) } : { head: markdown(src.slice(0, cut)), body: markdown(src.slice(cut)) },
    });
  },
  toggleSpoiler() { this.setData({ spoiler: !this.data.spoiler }); },
  async attempt(e) {
    const result = e.currentTarget.dataset.r;
    try {
      await api.study('/algo', 'POST', { slug: this.slug, result });
      await store.refreshAttempts();
      toast(result === 'ac' ? '已记录：做出来了 ✓' : '已记录，明天再做一遍');
      this.render();
    } catch (err) { toast('记录失败：' + err.message); }
  },
  async delAttempt(e) {
    if (!await confirm('删除这条做题记录？')) return;
    try {
      await api.study(`/algo/${e.currentTarget.dataset.i}`, 'DELETE');
      await store.refreshAttempts();
      this.render();
    } catch (err) { toast('删除失败：' + err.message); }
  },
  copy() { nav.copy(this.data.p.url); },
  go(e) { nav.go(e.currentTarget.dataset.h); },
  turn(e) { nav.go(e.currentTarget.dataset.h, true); },
});
