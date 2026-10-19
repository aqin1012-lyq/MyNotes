const store = require('../../utils/store');

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { error: String },
  methods: {
    retry() {
      wx.showLoading({ title: '加载中…' });
      store.load(true)
        .then(() => this.triggerEvent('retry'))
        .catch(e => this.setData({ error: e.message }))
        .then(() => wx.hideLoading());
    },
  },
});
