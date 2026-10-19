/* 学习热力图: cols from store.heatmap(), scrolled so the current week is visible. */
const { toast } = require('../../utils/util');

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { cols: Array, weeks: { type: Number, value: 26 } },
  data: { left: 0 },
  observers: { cols() { this.setData({ left: 99999 }); } },
  methods: {
    tap(e) {
      const { k, m } = e.currentTarget.dataset;
      if (k) toast(`${k}：${m ? m + ' 分钟' : '未学习'}`);
    },
  },
});
