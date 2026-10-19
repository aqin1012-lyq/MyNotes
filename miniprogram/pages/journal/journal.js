const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');
const api = require('../../utils/api');
const { today, hours, toast, confirm } = require('../../utils/util');

page({
  data: { date: today(), minutes: '60', text: '', topicIdx: 0 },
  render() {
    const { S, topicById } = store;
    // the web's <optgroup> per stage, flattened
    this.topicIds = [''];
    const names = ['（不关联主题）'];
    S.C.stages.forEach(s => s.topics.forEach(t => { this.topicIds.push(t.id); names.push(`${s.title} · ${t.title}`); }));
    if (!this.picked) {
      const cur = store.nextTopic();
      this.setData({ topicIdx: cur ? this.topicIds.indexOf(cur.id) : 0 });
    }
    const byTopic = {};
    S.log.forEach(e => { byTopic[e.topicId] = (byTopic[e.topicId] || 0) + e.minutes; });
    this.setData({
      topicNames: names,
      heat: store.heatmap(26),
      byTopic: Object.entries(byTopic).sort((a, b) => b[1] - a[1])
        .map(([id, m]) => ({ id, title: topicById[id] ? topicById[id].title : '', h: hours(m) })),
      log: [...S.log].reverse().map(e => ({ ...e, topic: topicById[e.topicId] ? topicById[e.topicId].title : '' })),
    });
  },
  pickDate(e) { this.setData({ date: e.detail.value }); },
  pickTopic(e) { this.picked = true; this.setData({ topicIdx: +e.detail.value }); },
  setMinutes(e) { this.setData({ minutes: e.detail.value }); },
  setText(e) { this.setData({ text: e.detail.value }); },
  async submit() {
    const minutes = +this.data.minutes;
    if (!(minutes >= 1 && minutes <= 1440)) { toast('分钟数要在 1–1440 之间'); return; }
    try {
      await api.study('/log', 'POST', { date: this.data.date, minutes, topicId: this.topicIds[this.data.topicIdx], text: this.data.text });
      await store.refreshLog();
      toast('已打卡 ✓');
      this.setData({ text: '' });
      this.render();
    } catch (err) { toast('打卡失败：' + err.message); }
  },
  async del(e) {
    if (!await confirm('删除这条记录？')) return;
    try {
      await api.study(`/log/${e.currentTarget.dataset.i}`, 'DELETE');
      await store.refreshLog();
      this.render();
    } catch (err) { toast('删除失败：' + err.message); }
  },
  go(e) { nav.go(e.currentTarget.dataset.h); },
});
