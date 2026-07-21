const { PermissionFlagsBits } = require('discord.js');
const { getGuildConfig } = require('../database');

// Grades de sécurité :
//   0 = tout le monde
//   2 = staff (rôle staff configuré, ou permission "Modérer les membres")
//   3 = administration (rôle admin configuré, ou permission "Administrateur")
const GRADES = { EVERYONE: 0, STAFF: 2, ADMIN: 3 };
const GRADE_NAMES = { 0: 'Membre', 2: 'Staff', 3: 'Administration' };

// PLUSIEURS rôles staff/admin possibles : colonne historique (un seul rôle)
// + colonnes *_role_ids (liste JSON), fusionnées ici.
function parseRoleList(single, json) {
  const ids = new Set();
  if (single) ids.add(single);
  try {
    for (const id of JSON.parse(json || '[]')) if (id) ids.add(String(id));
  } catch {}
  return [...ids];
}
const staffRoleIds = (cfg) => parseRoleList(cfg.staff_role_id, cfg.staff_role_ids);
const adminRoleIds = (cfg) => parseRoleList(cfg.admin_role_id, cfg.admin_role_ids);

function getGrade(member, config) {
  // Membre absent ou objet brut (contexte app utilisateur hors serveur du
  // bot) : pas de permissions exploitables → grade minimal.
  if (!member || typeof member.permissions?.has !== 'function' || !member.roles?.cache) {
    return GRADES.EVERYONE;
  }
  const cfg = config || getGuildConfig(member.guild.id);
  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    adminRoleIds(cfg).some((id) => member.roles.cache.has(id))
  ) {
    return GRADES.ADMIN;
  }
  if (
    staffRoleIds(cfg).some((id) => member.roles.cache.has(id)) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers)
  ) {
    return GRADES.STAFF;
  }
  return GRADES.EVERYONE;
}

module.exports = { GRADES, GRADE_NAMES, getGrade, staffRoleIds, adminRoleIds };
