const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');
const { pct } = require('../../utils/util');

const DIFFS = [['', '全部难度'], ['E', '简单'], ['M', '中等'], ['H', '困难']];
const STATES = [['', '全部状态'], ['new', '未做'], ['due', '今日该做'], ['retry', '待重做'], ['learning', '复习中'], ['mastered', '已掌握']];

page({
  data: { q: '', diffIdx: 0, stateIdx: 0, diffNames: DIFFS.map(d => d[1]), stateNames: STATES.map(s => s[1]) },
  render() {
    const { S, setById, algoStats } = store;
    const ALGO = S.ALGO;
    const set = setById[wx.getStorageSync('algoSet')] || ALGO.sets[0];
    const { all, solved, mastered } = algoStats(set.id);
    const due = algoStats().due; // today's reviews span every set
    const byDiff = d => `${all.filter(x => x.p.diff === d && x.st.solved).length}/${all.filter(x => x.p.diff === d).length}`;
    this.cats = set.categories.map(c => {
      const rows = all.filter(x => x.p.cat === c.id);
      const done = rows.filter(x => x.st.solved).length;
      return {
        id: c.id, title: c.title, done, total: rows.length, pct: pct(done, rows.length),
        rows: rows.map(({ p, st }) => ({
          slug: p.slug, no: p.no == null ? '—' : p.no, title: p.title, diff: p.diff, diffLabel: store.DIFF[p.diff],
          state: st.state, status: store.statusText(st), url: p.url || '',
          q: (p.no + ' ' + p.title + ' ' + p.slug).toLowerCase(),
        })),
      };
    });
    this.setData({
      sets: ALGO.sets.map(x => ({ id: x.id, title: x.title, on: x.id === set.id, solved: algoStats(x.id).solved, total: ALGO.problems.filter(p => p.set === x.id).length })),
      desc: set.desc,
      tiles: { solved, total: all.length, E: byDiff('E'), M: byDiff('M'), H: byDiff('H'), due: due.length, review: ALGO.review.join('/'), mastered, streak: ALGO.review.length + 1 },
      due: due.map(({ p, st }) => ({ slug: p.slug, label: store.plabel(p), st: st.label })),
    });
    this.apply();
  },
  apply() {
    const q = this.data.q.trim().toLowerCase();
    const df = DIFFS[this.data.diffIdx][0];
    const sf = STATES[this.data.stateIdx][0];
    let n = 0;
    const cats = this.cats.map(c => {
      const rows = c.rows.filter(r => (!q || r.q.includes(q)) && (!df || r.diff === df) && (!sf || r.state === sf));
      n += rows.length;
      return { ...c, rows };
    }).filter(c => c.rows.length);
    this.setData({ cats, count: n });
  },
  search(e) { this.setData({ q: e.detail.value }); this.apply(); },
  pickDiff(e) { this.setData({ diffIdx: +e.detail.value }); this.apply(); },
  pickState(e) { this.setData({ stateIdx: +e.detail.value }); this.apply(); },
  pickSet(e) { wx.setStorageSync('algoSet', e.currentTarget.dataset.id); this.render(); },
  go(e) { nav.go(e.currentTarget.dataset.h); },
  copy(e) { nav.copy(e.currentTarget.dataset.url); },
});
