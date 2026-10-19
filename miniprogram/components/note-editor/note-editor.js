/* The web app's note editor (noteEditor + mountNoteEditor): load note <id>, autosave 800 ms after typing.
   Phones get 编辑 / 预览 tabs instead of the split view. */
const api = require('../../utils/api');
const store = require('../../utils/store');
const { markdown } = require('../../utils/markdown');
const { deleteNote } = require('../../utils/notes');
const { dateTime, time } = require('../../utils/util');

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    noteId: String,
    template: String,
    placeholder: String,
    saveNow: Boolean,   // a note created from 新建 is saved right away, even if untouched
    mode: { type: String, value: 'preview' },
    bare: Boolean,      // the 笔记 page puts the controls in its own header
    leaveOnDelete: Boolean, // emit "deleted" instead of resetting to the template
  },
  data: { text: '', blocks: [], status: '', current: 'preview', loaded: false },
  observers: {
    mode(m) { if (this.data.loaded) this.setMode(m); },
  },
  lifetimes: {
    attached() { this.load(); },
    detached() { this.save(); },
  },
  pageLifetimes: {
    hide() { this.save(); },
  },
  methods: {
    async load() {
      this.dirty = false; // a template alone isn't worth a file, unless the user explicitly created the note
      let note;
      try {
        note = await api.study(`/notes/${this.properties.noteId}`);
      } catch (e) {
        this.status('加载失败：' + e.message);
        return;
      }
      this.text = note ? note.content : (this.properties.template || '');
      this.setData({ loaded: true });
      this.setMode(this.properties.mode);
      this.status(note ? `上次保存 ${dateTime(note.updatedAt)}` : '尚未保存');
      if (!note && this.properties.saveNow) {
        this.dirty = true;
        await this.save();
        store.refreshNotes();
      }
    },
    status(text) {
      if (text === this.data.status) return;
      this.setData({ status: text });
      this.triggerEvent('status', { text });
    },
    setMode(m) {
      m = m === 'edit' ? 'edit' : 'preview';
      if (m === 'preview') this.setData({ current: m, blocks: markdown(this.text) });
      else this.setData({ current: m, text: this.text });
    },
    tab(e) { this.setMode(e.currentTarget.dataset.mode); },
    input(e) {
      this.text = e.detail.value;
      this.dirty = true;
      this.status('编辑中…');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.save(), 800);
    },
    // also the page's flush hook (e.g. before a rename moves the file)
    async save() {
      clearTimeout(this.timer);
      if (!this.dirty) return;
      this.dirty = false;
      try {
        await api.study(`/notes/${this.properties.noteId}`, 'PUT', { content: this.text });
        this.status(`已保存 ${time(new Date())}`);
        this.triggerEvent('saved');
      } catch (e) {
        this.dirty = true;
        this.status('保存失败：' + e.message);
      }
    },
    async remove() {
      clearTimeout(this.timer);
      const dirty = this.dirty;
      this.dirty = false;
      if (!await deleteNote(this.properties.noteId)) { this.dirty = dirty; return; }
      if (this.properties.leaveOnDelete) { this.triggerEvent('deleted'); return; }
      this.text = this.properties.template || ''; // back to a fresh, unsaved template
      this.setMode(this.data.current);
      this.status('已删除，重新输入会新建');
    },
  },
});
