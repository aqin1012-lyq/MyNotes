const nav = require('../../utils/nav');

Component({
  options: { styleIsolation: 'apply-shared', virtualHost: true },
  properties: { toks: Array },
  methods: {
    go(e) { nav.go(e.currentTarget.dataset.h); },
  },
});
