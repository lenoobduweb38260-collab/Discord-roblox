// Un discord.js suffisant pour éprouver le rendu : les constructeurs produisent
// le VRAI JSON de l'API, seul juge du résultat.
class EmbedBuilder {
  constructor(data = {}) { this.data = { ...data }; }
  setColor(c) { if (c != null) this.data.color = c; return this; }
  setTitle(t) { this.data.title = t; return this; }
  setURL(u) { this.data.url = u; return this; }
  setDescription(d) { this.data.description = d; return this; }
  setImage(u) { if (typeof u !== 'string' || !u) throw new Error('image invalide'); this.data.image = { url: u }; return this; }
  setThumbnail(u) { this.data.thumbnail = u ? { url: u } : undefined; return this; }
  setFooter(f) { this.data.footer = f; return this; }
  setAuthor(a) { this.data.author = a; return this; }
  setTimestamp(t) { this.data.timestamp = new Date(t || 0).toISOString(); return this; }
  addFields(...f) { this.data.fields = [...(this.data.fields || []), ...f.flat()]; return this; }
  toJSON() { return JSON.parse(JSON.stringify(this.data)); }
}
class ActionRowBuilder {
  constructor() { this.components = []; }
  addComponents(...c) { this.components.push(...c.flat()); return this; }
  toJSON() { return { type: 1, components: this.components.map((c) => c.toJSON()) }; }
}
class ButtonBuilder {
  constructor() { this.d = { type: 2, style: 2 }; }
  setCustomId(v) { this.d.custom_id = v; return this; }
  setLabel(v) { this.d.label = v; return this; }
  setEmoji(v) {
    if (typeof v !== 'string' || !v.trim()) throw new Error('émoji invalide');
    const p = /^<a?:([\w~]+):(\d+)>$/.exec(v);
    this.d.emoji = p ? { id: p[2], name: p[1] } : { name: v };
    return this;
  }
  setStyle(v) { this.d.style = v ?? 2; return this; }
  setDisabled(v) { this.d.disabled = v; return this; }
  setURL(v) { this.d.url = v; return this; }
  toJSON() { return { ...this.d }; }
}
class SelectBase {
  constructor(type) { this.d = { type }; }
  setCustomId(v) { this.d.custom_id = v; return this; }
  setPlaceholder(v) { this.d.placeholder = v; return this; }
  setMinValues(v) { this.d.min_values = v; return this; }
  setMaxValues(v) { this.d.max_values = v; return this; }
  addChannelTypes(...v) { this.d.channel_types = v.flat(); return this; }
  addOptions(...v) { this.d.options = [...(this.d.options || []), ...v.flat()]; return this; }
  toJSON() { return { ...this.d }; }
}
class TextInputBuilder {
  constructor() { this.d = { type: 4 }; }
  setCustomId(v) { this.d.custom_id = v; return this; }
  setLabel(v) { this.d.label = v; return this; }
  setStyle(v) { this.d.style = v; return this; }
  setRequired(v) { this.d.required = v; return this; }
  setMaxLength(v) { this.d.max_length = v; return this; }
  setPlaceholder(v) { this.d.placeholder = v; return this; }
  setValue(v) { this.d.value = v; return this; }
  toJSON() { return { ...this.d }; }
}
class ModalBuilder {
  constructor() { this.d = { components: [] }; }
  setCustomId(v) { this.d.custom_id = v; return this; }
  setTitle(v) { this.d.title = v; return this; }
  addComponents(...c) { this.d.components.push(...c.flat()); return this; }
  toJSON() { return { ...this.d, components: this.d.components.map((c) => c.toJSON()) }; }
}
class Option {
  setName() { return this; } setDescription() { return this; } setRequired() { return this; }
  addChoices() { return this; } setMinValue() { return this; } setMaxValue() { return this; }
  setAutocomplete() { return this; } addChannelTypes() { return this; }
  setMaxLength() { return this; } setMinLength() { return this; }
  setNameLocalizations() { return this; } setDescriptionLocalizations() { return this; }
}
class SlashCommandBuilder {
  setName(v) { this.name = v; return this; }
  setDescription(v) { this.description = v; return this; }
  setNameLocalizations() { return this; }
  setDescriptionLocalizations() { return this; }
  setContexts() { return this; }
  setIntegrationTypes() { return this; }
  setDMPermission() { return this; }
  setDefaultMemberPermissions() { return this; }
  setNSFW() { return this; }
  addSubcommand(f) { (this.subs ||= []).push(f(new SlashCommandBuilder())); return this; }
  addSubcommandGroup(f) { (this.groupes ||= []).push(f(new SlashCommandBuilder())); return this; }
  addStringOption(f) { f(new Option()); return this; }
  addIntegerOption(f) { f(new Option()); return this; }
  addNumberOption(f) { f(new Option()); return this; }
  addChannelOption(f) { f(new Option()); return this; }
  addRoleOption(f) { f(new Option()); return this; }
  addUserOption(f) { f(new Option()); return this; }
  addBooleanOption(f) { f(new Option()); return this; }
  addAttachmentOption(f) { f(new Option()); return this; }
  addMentionableOption(f) { f(new Option()); return this; }
}
module.exports = {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, TextInputBuilder, ModalBuilder, SlashCommandBuilder,
  ChannelSelectMenuBuilder: class extends SelectBase { constructor() { super(8); } },
  RoleSelectMenuBuilder: class extends SelectBase { constructor() { super(6); } },
  StringSelectMenuBuilder: class extends SelectBase { constructor() { super(3); } },
  UserSelectMenuBuilder: class extends SelectBase { constructor() { super(5); } },
  ButtonStyle: { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 },
  TextInputStyle: { Short: 1, Paragraph: 2 },
  ChannelType: { GuildText: 0, GuildVoice: 2, GuildCategory: 4, GuildAnnouncement: 5, PublicThread: 11, PrivateThread: 12 },
  MessageFlags: { Ephemeral: 64 },
  PermissionFlagsBits: {
    ManageChannels: 1n << 4n, Stream: 1n << 9n, ViewChannel: 1n << 10n,
    Connect: 1n << 20n, MoveMembers: 1n << 24n, ManageRoles: 1n << 28n,
    ModerateMembers: 1n << 40n, Administrator: 1n << 3n, SetVoiceChannelStatus: 1n << 48n,
  },
  AttachmentBuilder: class { constructor(d, o) { this.data = d; this.name = o?.name; } },
  Events: new Proxy({}, { get: (_, k) => String(k) }),
  InteractionContextType: { Guild: 0, BotDM: 1, PrivateChannel: 2 },
  ApplicationIntegrationType: { GuildInstall: 0, UserInstall: 1 },
  AuditLogEvent: new Proxy({}, { get: (_, k) => String(k) }),
};
