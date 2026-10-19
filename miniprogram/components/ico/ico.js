const { icon } = require('../../utils/icons');

Component({
  options: { styleIsolation: 'apply-shared', virtualHost: true },
  properties: { name: String, color: String, cls: String },
  observers: {
    'name, color'(name, color) { if (name) this.setData({ src: icon(name, color) }); },
  },
});
