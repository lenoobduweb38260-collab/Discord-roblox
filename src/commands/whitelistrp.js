const { makeRpListCommand } = require('../utils/rpListCommand');

module.exports = makeRpListCommand({
  kind: 'wlrp',
  name: 'whitelistrp',
  label: 'Whitelist',
  verb: 'Whitelister',
});
