const api = require('../../utils/api');
const nav = require('../../utils/nav');
const { today, toast } = require('../../utils/util');

Page({
  data: {
    links: [
      { h: '#/projects', icon: 'flask', title: '项目', sub: '每个阶段用一个项目把知识落地' },
      { h: '#/resources', icon: 'book', title: '资料库', sub: '全部权威资料，读完勾选' },
      { h: '#/journal', icon: 'flame', title: '学习日志', sub: '打卡、热力图、按主题累计' },
      { h: '#/principles', icon: 'heart', title: '原则与复盘', sub: '主线、关键节点、容易犯的错误' },
    ],
    usedKb: 0,
    limitKb: 0,
  },
  onShow() {
    const info = wx.getStorageInfoSync();
    this.setData({ usedKb: info.currentSize, limitKb: info.limitSize });
  },
  go(e) { nav.go(e.currentTarget.dataset.h); },
  // every note in one Markdown file, newest first
  async exportNotes() {
    const list = await api.study('/notes');
    if (!list.length) { toast('还没有笔记'); return; }
    const parts = [];
    for (const n of list) {
      const note = await api.study(`/notes/${n.id}`);
      parts.push(`<!-- ${n.id} · ${n.updatedAt} -->\n\n${note.content.trim()}\n`);
    }
    const md = parts.join('\n---\n\n');
    const { tapIndex } = await new Promise(resolve => wx.showActionSheet({
      itemList: ['复制到剪贴板', '存成文件发到聊天'], success: resolve, fail: () => resolve({}),
    }));
    if (tapIndex === 0) {
      wx.setClipboardData({ data: md, success: () => toast(`已复制 ${list.length} 篇笔记`) });
    } else if (tapIndex === 1) {
      const filePath = `${wx.env.USER_DATA_PATH}/mynotes-${today()}.md`;
      try {
        wx.getFileSystemManager().writeFileSync(filePath, md, 'utf8');
      } catch (e) {
        toast('导出失败：' + (e.errMsg || e.message));
        return;
      }
      wx.shareFileMessage({ filePath, fail: e => { if (!/cancel/.test(e.errMsg)) toast('发送失败：' + e.errMsg); } });
    }
  },
});
