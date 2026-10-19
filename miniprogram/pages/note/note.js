const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');
const md = require('../../utils/markdown');
const { renameNote } = require('../../utils/notes');

page({
  data: { mode: 'preview', status: '' },
  onLoad(o) {
    this.id = o.id;
    this.tpl = o.tpl || ''; // set only by 新建
    this.setData({ mode: o.mode === 'edit' ? 'edit' : 'preview' });
  },
  render() {
    const id = this.id;
    const kind = store.noteKind(id);
    if (!this.data.editor) {
      wx.setNavigationBarTitle({ title: store.noteTitle(id) });
      this.setData({
        editor: {
          id,
          template: kind === 'free' || kind === 'review' ? store.noteTemplate(this.tpl || 'study', id) : '',
          saveNow: !!this.tpl,
        },
      });
    }
    this.setData({
      kind: store.kindPill(id),
      title: md.emo(store.noteTitle(id)),
      renamable: store.renamable(id),
      home: kind === 'free' || kind === 'review' ? '' : store.noteHref(id),
    });
  },
  onStatus(e) { this.setData({ status: e.detail.text }); },
  view() { this.setData({ mode: 'preview' }); },
  edit() { this.setData({ mode: 'edit' }); },
  del() { this.selectComponent('#editor').remove(); },
  onDeleted() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/notes/notes' });
  },
  async rename() {
    await this.selectComponent('#editor').save(); // flush pending edits before the file moves
    const newId = await renameNote(this.id);
    if (newId) nav.open(`/pages/note/note?id=${newId}`, true);
  },
  home() { nav.go(this.data.home); },
});
