const store = require('../../utils/store');
const page = require('../../utils/page');
const nav = require('../../utils/nav');
const api = require('../../utils/api');
const md = require('../../utils/markdown');
const { renameNote, deleteNote } = require('../../utils/notes');
const { dateTime, toast } = require('../../utils/util');

const SORTS = [['updated', '最近更新'], ['title', '按标题'], ['length', '按字数']];
const KINDS = Object.keys(store.NOTE_KINDS);

page({
  data: { q: '', kindIdx: 0, sortIdx: 0, tpl: 'study', newId: '', sortNames: SORTS.map(s => s[1]) },
  async render() {
    if (!this.data.tpls) {
      this.setData({ tpls: Object.entries(store.NOTE_TEMPLATES).map(([k, v]) => ({ k, label: md.emo(v.label) })) });
    }
    await store.refreshNotes(); // as the web does when opening 笔记
    await this.list();
  },
  async list() {
    const { S } = store;
    const counts = Object.fromEntries(KINDS.map(k => [k, S.notes.filter(n => store.noteKind(n.id) === k).length]));
    const kindNames = ['全部类型', ...KINDS.map(k => `${store.NOTE_KINDS[k].label}（${counts[k]}）`)];
    const q = this.data.q.trim();
    let list = q ? await api.study(`/notes?q=${encodeURIComponent(q)}`) || [] : S.notes;
    const kind = this.data.kindIdx ? KINDS[this.data.kindIdx - 1] : '';
    if (kind) list = list.filter(n => store.noteKind(n.id) === kind);
    const by = {
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      title: (a, b) => store.noteTitle(a.id).localeCompare(store.noteTitle(b.id), 'zh'),
      length: (a, b) => b.length - a.length,
    }[SORTS[this.data.sortIdx][0]];
    list = [...list].sort(by);
    this.setData({
      kindNames,
      count: q ? `找到 ${list.length} 篇` : `共 ${list.length} 篇`,
      notes: list.map(n => ({
        id: n.id, kind: store.kindPill(n.id), renamable: store.renamable(n.id),
        title: md.highlight(store.noteTitle(n.id), q),
        body: n.snippet ? md.highlight(n.snippet, q) : n.excerpt ? md.inline(store.cleanExcerpt(n.excerpt)) : md.emo('（空笔记）'),
        idToks: md.highlight(n.id, q), time: dateTime(n.updatedAt), length: n.length,
      })),
    });
  },
  search(e) {
    this.setData({ q: e.detail.value });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.list(), 250);
  },
  pickKind(e) { this.setData({ kindIdx: +e.detail.value }); this.list(); },
  pickSort(e) { this.setData({ sortIdx: +e.detail.value }); this.list(); },
  pickTpl(e) {
    const k = e.currentTarget.dataset.k;
    const tpl = store.NOTE_TEMPLATES[k];
    this.setData({ tpl: k, newId: tpl.id && !this.data.newId ? tpl.id() : this.data.newId });
  },
  setId(e) { this.setData({ newId: e.detail.value }); },
  create() {
    const id = this.data.newId.trim().toLowerCase();
    if (!store.NOTE_ID_RE.test(id)) { toast('只能用小写字母、数字和 -'); return; }
    const exists = store.S.notes.some(n => n.id === id);
    if (exists) toast('这个 id 已经有笔记了，直接打开');
    this.setData({ newId: '' });
    nav.open(`/pages/note/note?id=${id}&mode=edit${exists ? '' : `&tpl=${this.data.tpl}`}`);
  },
  view(e) { nav.open(`/pages/note/note?id=${e.currentTarget.dataset.id}`); },
  edit(e) { nav.open(`/pages/note/note?id=${e.currentTarget.dataset.id}&mode=edit`); },
  async rename(e) { if (await renameNote(e.currentTarget.dataset.id)) this.list(); },
  async del(e) { if (await deleteNote(e.currentTarget.dataset.id)) this.list(); },
});
