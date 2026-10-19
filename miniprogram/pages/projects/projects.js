const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');

page({
  render() {
    this.setData({
      projects: store.S.C.projects.map(p => ({ id: p.id, title: p.title, period: p.period, stack: p.stack, ...store.stats(store.projectItems(p)) })),
    });
  },
  go(e) { nav.go(e.currentTarget.dataset.h); },
});
