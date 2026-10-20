const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');
const { daysUntil } = require('../../utils/util');

page({
  share() { return { title: '原则与复盘 · 我的安全学习主线' }; },
  render() {
    const C = store.S.C;
    this.setData({
      mission: C.mission, identity: C.identity,
      checkpoints: C.checkpoints.map(c => ({ ...c, days: daysUntil(c.date) })),
      pitfalls: C.pitfalls, careers: C.careers, certs: C.certs,
    });
  },
  go(e) { nav.go(e.currentTarget.dataset.h); },
  copy(e) { nav.copy(e.currentTarget.dataset.url); },
});
