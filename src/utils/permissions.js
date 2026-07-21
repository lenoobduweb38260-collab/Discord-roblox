const { PermissionFlagsBits } = require('discord.js');
const { getGuildConfig } = require('../database');

// Grades de sécurité :
//   0 = tout le monde
//   2 = staff (rôle staff configuré, ou permission "Modérer les membres")
//   3 = administration (rôle admin configuré, ou permission "Administrateur")
const GRADES = { EVERYONE: 0, STAFF: 2, ADMIN: 3 };
const GRADE_NAMES = { 0: 'Membre', 2: 'Staff', 3: 'Administration' };

function getGrade(member, config) {
  // Membre absent ou objet brut (contexte app utilisateur hors serveur du
  // bot) : pas de permissions exploitables → grade minimal.
  if (!member || typeof member.permissions?.has !== 'function' || !member.roles?.cache) {
    return GRADES.EVERYONE;
  }
  const cfg = config || getGuildConfig(member.guild.id);
  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    (cfg.admin_role_id && member.roles.cache.has(cfg.admin_role_id))
  ) {
    return GRADES.ADMIN;
  }
  if (
    (cfg.staff_role_id && member.roles.cache.has(cfg.staff_role_id)) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers)
  ) {
    return GRADES.STAFF;
  }
  return GRADES.EVERYONE;
}

module.exports = { GRADES, GRADE_NAMES, getGrade };
