const { makeRpListCommand } = require('../utils/rpListCommand');

module.exports = makeRpListCommand({
  kind: 'blrp',
  name: 'blacklistrp',
  label: 'Blacklist',
  verb: 'Blacklister',
});
