const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');
const { toast } = require('../../utils/util');

const DONE = [['', '全部'], ['0', '未读'], ['1', '已读']];

page({
  data: { q: '', typeIdx: 0, stageIdx: 0, doneIdx: 0, doneNames: DONE.map(d => d[1]) },
  render() {
    const { S, topics } = store;
    this.all = topics.flatMap(t => (t.resources || []).map((r, i) => ({
      id: `${t.id}:r${i}`, type: r.type, t: r.t, u: r.u || '', topicId: t.id, topic: t.title,
      stageId: store.stageOf(t.id).id, stage: store.stageOf(t.id).title, q: (r.t + ' ' + t.title).toLowerCase(),
    })));
    this.types = [...new Set(this.all.map(r => r.type))];
    this.stages = S.C.stages.map(s => ({ id: s.id, title: s.title }));
    this.setData({
      total: this.all.length,
      typeNames: ['全部类型', ...this.types],
      stageNames: ['全部阶段', ...this.stages.map(s => s.title)],
    });
    this.apply();
  },
  apply() {
    const p = store.S.progress;
    const q = this.data.q.trim().toLowerCase();
    const ty = this.data.typeIdx ? this.types[this.data.typeIdx - 1] : '';
    const sg = this.data.stageIdx ? this.stages[this.data.stageIdx - 1].id : '';
    const dn = DONE[this.data.doneIdx][0];
    const rows = this.all.filter(r => (!q || r.q.includes(q)) && (!ty || r.type === ty) && (!sg || r.stageId === sg)
      && (!dn || (p[r.id] ? '1' : '0') === dn)).map(r => ({ ...r, done: p[r.id] || '' }));
    this.setData({ rows, read: this.all.filter(r => p[r.id]).length });
  },
  search(e) { this.setData({ q: e.detail.value }); this.apply(); },
  pickType(e) { this.setData({ typeIdx: +e.detail.value }); this.apply(); },
  pickStage(e) { this.setData({ stageIdx: +e.detail.value }); this.apply(); },
  pickDone(e) { this.setData({ doneIdx: +e.detail.value }); this.apply(); },
  async toggle(e) {
    const r = this.data.rows[e.currentTarget.dataset.i];
    try {
      await store.setProgress(r.id, !r.done);
      this.apply();
    } catch (err) { toast('保存失败：' + err.message); }
  },
  open(e) {
    const r = this.data.rows[e.currentTarget.dataset.i];
    if (r.u) nav.copy(r.u);
  },
  go(e) { nav.go(e.currentTarget.dataset.h); },
});
