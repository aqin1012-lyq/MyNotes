const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');
const { toast } = require('../../utils/util');

page({
  onLoad(o) { this.id = o.id; },
  render() {
    const p = store.S.C.projects.find(x => x.id === this.id);
    if (!p) { this.setData({ missing: true }); return; }
    if (!this.titled) {
      this.titled = true;
      wx.setNavigationBarTitle({ title: p.title });
      this.setData({ template: `# ${p.title}\n\n## 架构图\n\n\n## 设计决策\n\n\n## 踩坑记录\n\n\n## 简历描述（STAR）\n\n` });
    }
    const ids = store.projectItems(p);
    this.setData({
      p: { id: p.id, title: p.title, period: p.period, stack: p.stack, link: p.link || '' },
      st: store.stats(ids),
      items: ids.map((id, i) => ({ id, label: p.milestones[i], done: store.S.progress[id] || '' })),
    });
  },
  onCheck() {
    const p = store.S.C.projects.find(x => x.id === this.id);
    const st = store.stats(store.projectItems(p));
    this.setData({ st });
    if (st.pct === 100) toast('🎉 完成了一个主题！');
  },
  go(e) { nav.go(e.currentTarget.dataset.h); },
});
