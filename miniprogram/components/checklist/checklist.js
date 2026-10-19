/* Progress checkboxes: items are { id, label, done (date or ''), type?, url? }. Emits "change" after saving. */
const store = require('../../utils/store');
const nav = require('../../utils/nav');
const { toast } = require('../../utils/util');

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { items: Array },
  methods: {
    async toggle(e) {
      const i = e.currentTarget.dataset.i;
      const item = this.data.items[i];
      const done = !item.done;
      this.setData({ [`items[${i}].done`]: done ? '…' : '' });
      try {
        const progress = await store.setProgress(item.id, done);
        this.setData({ [`items[${i}].done`]: progress[item.id] || '' });
        this.triggerEvent('change', { id: item.id, done });
      } catch (err) {
        this.setData({ [`items[${i}].done`]: item.done });
        toast('保存失败：' + err.message);
      }
    },
    // a resource's title is a link (copied, since a mini program can't open web pages); anything else toggles
    tapLabel(e) {
      const item = this.data.items[e.currentTarget.dataset.i];
      if (item.url) nav.copy(item.url);
      else this.toggle(e);
    },
  },
});
