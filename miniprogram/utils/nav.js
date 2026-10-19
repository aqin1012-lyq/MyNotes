/* The web app's #/ links, mapped onto mini program pages. */
const { toast } = require('./util');

const TABS = ['dashboard', 'roadmap', 'algo', 'notes'];
const app = () => getApp();

function open(url, replace) {
  // the page stack holds 10 pages; past that, swap the current one instead
  if (replace || getCurrentPages().length >= 9) wx.redirectTo({ url });
  else wx.navigateTo({ url });
}

function copy(url) {
  wx.setClipboardData({ data: url, success: () => toast('链接已复制，可粘贴到浏览器打开') });
}

function go(href, replace) {
  if (!href) return;
  if (/^https?:\/\//.test(href)) return copy(href);
  if (href[0] === '/') return; // a path on the web version's server; the mini program has none
  const [view = 'dashboard', arg, sub] = href.replace(/^#\/?/, '').split('/');
  const q = encodeURIComponent;
  if (view === 'roadmap') app().globalData.roadmapStage = arg || '';
  if (TABS.includes(view) && !(view === 'algo' && arg) && !(view === 'notes' && arg)) {
    return wx.switchTab({ url: `/pages/${view}/${view}` });
  }
  if (view === 'topic') return open(`/pages/topic/topic?id=${q(arg)}${sub ? `&sec=${q(sub)}` : ''}`, replace);
  if (view === 'algo') return open(`/pages/problem/problem?slug=${q(arg)}`, replace);
  if (view === 'note') return go(require('./store').noteHref(arg), replace);
  if (view === 'notes') return open(`/pages/note/note?id=${q(arg)}`, replace);
  if (view === 'projects') return open(arg ? `/pages/project/project?id=${q(arg)}` : '/pages/projects/projects', replace);
  if (['resources', 'journal', 'principles'].includes(view)) return open(`/pages/${view}/${view}`, replace);
  wx.switchTab({ url: '/pages/dashboard/dashboard' });
}

module.exports = { go, copy, open };
