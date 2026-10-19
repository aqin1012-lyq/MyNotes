/* Renders utils/markdown.js blocks; nests itself for callouts, cards, folds and quotes. */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { blocks: Array, cls: String },
  data: { open: {} },
  observers: { blocks() { this.setData({ open: {} }); } },
  methods: {
    toggle(e) {
      const i = e.currentTarget.dataset.i;
      this.setData({ [`open.${i}`]: !this.data.open[i] });
    },
    // the lesson TOC: scroll the page so heading #id sits at the top
    scrollToId(id) {
      this.createSelectorQuery().select('#' + id).boundingClientRect().selectViewport().scrollOffset().exec(([r, vp]) => {
        if (r) wx.pageScrollTo({ scrollTop: r.top + vp.scrollTop - 8, duration: 300 });
      });
    },
  },
});
