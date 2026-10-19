/* Rename / delete, shared by the 笔记 list, the note page and the editor (renameNote / deleteNote on the web). */
const api = require('./api');
const store = require('./store');
const { toast, confirm } = require('./util');

async function renameNote(id) {
  const r = await new Promise(resolve => wx.showModal({
    title: `把笔记「${store.noteTitle(id)}」的 id 改成：`, editable: true, content: id, placeholderText: '只能用小写字母、数字和 -',
    success: resolve, fail: () => resolve({}),
  }));
  if (!r.confirm) return null;
  const newId = (r.content || '').trim().toLowerCase();
  if (!newId || newId === id) return null;
  if (!store.NOTE_ID_RE.test(newId)) { toast('只能用小写字母、数字和 -'); return null; }
  try {
    await api.study(`/notes/${id}/rename`, 'POST', { newId });
  } catch (e) {
    toast(e.message.includes('409') ? '这个 id 已经被占用了' : '重命名失败：' + e.message);
    return null;
  }
  await store.refreshNotes();
  toast('已重命名');
  return newId;
}

async function deleteNote(id) {
  if (!await confirm(`删除笔记「${store.noteTitle(id)}」？\n删除后无法恢复。`)) return false;
  try {
    await api.study(`/notes/${id}`, 'DELETE');
  } catch (e) {
    toast('删除失败：' + e.message);
    return false;
  }
  await store.refreshNotes();
  toast('已删除');
  return true;
}

module.exports = { renameNote, deleteNote };
