const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');

page({
  render() {
    const { S, stageStats, topicStats } = store;
    const cur = store.currentStage();
    this.setData({
      identity: S.C.identity,
      stages: S.C.stages.map((s, n) => ({
        id: s.id, n: n + 1, title: s.title, from: s.from, to: s.to, goal: s.goal, cur: s === cur, ...stageStats(s),
        topics: s.topics.map(t => ({ id: t.id, title: t.title, month: t.month, ...topicStats(t) })),
      })),
    });
    // #/roadmap/<stage> links scroll to that stage
    const stage = getApp().globalData.roadmapStage;
    if (stage) {
      getApp().globalData.roadmapStage = '';
      wx.nextTick(() => wx.pageScrollTo({ selector: '#stage-' + stage, duration: 300 }));
    }
  },
  go(e) { nav.go(e.currentTarget.dataset.h); },
});
