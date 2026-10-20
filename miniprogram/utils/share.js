/* Forwarding to friends / Moments.
 * Progress, notes and the journal live only on each user's phone, so a friend opening someone's note page would see
 * nothing. Pages whose content is the same for everyone (topics, problems, the roadmap…) define share() and forward
 * themselves; every other page forwards the dashboard. */

const HOME = { title: 'MyNotes · Java 后端 → Web 安全成长路线', path: '/pages/dashboard/dashboard' };

// def.share(): { title, query? }, called with the page as `this`
module.exports = def => ({
  onShareAppMessage() {
    const s = def.share && def.share.call(this);
    if (!s) return HOME;
    return { title: s.title, path: `/${this.route}${s.query ? `?${s.query}` : ''}` };
  },
  ...(def.share ? {
    onShareTimeline() {
      const s = def.share.call(this) || HOME;
      return { title: s.title, query: s.query || '' };
    },
  } : {}),
});

module.exports.HOME = HOME;
