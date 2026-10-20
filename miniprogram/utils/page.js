/* Shared page plumbing: wait for the store, show the offline screen if the backend is down, forwarding. */
const store = require('./store');
const share = require('./share');

// wraps a Page definition; the page implements render() (sync or async) and optionally share()
module.exports = def => Page({
  ...share(def),
  ...def,
  data: { ready: false, error: '', ...(def.data || {}) },
  async refresh(force) {
    try {
      await store.load(force);
      await this.render();
      if (!this.data.ready || this.data.error) this.setData({ ready: true, error: '' });
    } catch (e) {
      this.setData({ error: e.message || String(e) });
    }
  },
  onShow() {
    if (def.onShow) def.onShow.call(this);
    this.refresh();
  },
  async onPullDownRefresh() {
    await this.refresh(true);
    wx.stopPullDownRefresh();
  },
  onRetry() { this.refresh(); },
});
