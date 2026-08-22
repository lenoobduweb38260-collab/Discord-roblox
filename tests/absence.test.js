// 📅 Les absences : la lecture des champs, la vie d'une annonce, le balayage.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AIDES = path.join(__dirname, 'aides');

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'absence-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  return vrai.apply(this, arguments);
};

const absences = require('../src/utils/absences');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

// Un client de laboratoire : des salons qui notent envois et suppressions.
let compteurMessage = 0; // global : les flocons Discord sont uniques, nos M<n> aussi
function fauxMonde() {
  const salons = new Map();
  const creerSalon = (id) => {
    const salon = {
      id,
      envois: [],
      supprimes: [],
      isTextBased: () => true,
      async send(m) { const msg = { id: `M${++compteurMessage}`, ...m }; salon.envois.push(msg); return msg; },
      messages: { async delete(mid) { salon.supprimes.push(mid); return true; } },
      permissionsFor: () => ({ has: () => true }),
    };
    salons.set(id, salon);
    return salon;
  };
  const client = { channels: { async fetch(id) { return salons.get(id) || null; } } };
  return { client, creerSalon, salons };
}

function fausseInteraction(monde, { user = 'U1', salon = 'C1', membreStaff = false, messageId = null, champs = {} } = {}) {
  const reponses = [];
  return {
    guildId: 'G1',
    user: { id: user },
    member: {
      roles: { cache: new Map() },
      permissions: { has: () => membreStaff },
      guild: { id: 'G1' },
    },
    channel: monde.salons.get(salon),
    client: monde.client,
    message: messageId ? { id: messageId, async delete() { return true; } } : null,
    fields: { getTextInputValue: (id) => champs[id] ?? '' },
    customId: null,
    async reply(m) { reponses.push(m); return {}; },
    async showModal(m) { reponses.push({ modale: m }); return {}; },
    reponses,
  };
}

(async () => {
  const JOUR = 24 * 3600 * 1000;

  console.log('\n1) Lire ce que la modale rapporte — chaque refus dit quoi corriger');
  {
    V('vide = maintenant (début)', absences.lireDate('') === null);
    const d = absences.lireDate('25/12/2030');
    V('une date JJ/MM/AAAA se lit', new Date(d).getDate() === 25 && new Date(d).getMonth() === 11);
    let refus = null;
    try { absences.lireDate('2030-12-25'); } catch (e) { refus = e.message; }
    V('un autre format est refusé AVEC un exemple', /JJ\/MM\/AAAA/.test(refus) && /exemple/.test(refus), refus);
    refus = null;
    try { absences.lireDate('31/02/2030'); } catch (e) { refus = e.message; }
    V('le 31 février n\'existe pas, et c\'est dit', /n'existe pas/.test(refus), refus);

    const debut = Date.now();
    V('fin vide = indéterminée', absences.lireFin('', debut) === null);
    V('« indéterminée » écrit en toutes lettres aussi', absences.lireFin('indéterminée', debut) === null);
    V('une durée en jours', absences.lireFin('5j', debut) === debut + 5 * JOUR);
    V('une durée en heures', absences.lireFin('12h', debut) === debut + 12 * 3600 * 1000);
    V('une durée en semaines', absences.lireFin('2sem', debut) === debut + 14 * JOUR);
    const finJour = absences.lireFin('25/12/2030', debut);
    V('une date de fin est INCLUSE (jusqu\'au soir)', new Date(finJour).getHours() >= 23, new Date(finJour).toString());
    refus = null;
    try { absences.lireFin('0j', debut); } catch (e) { refus = e.message; }
    V('une durée nulle renvoie vers le champ vide', /vide/.test(refus), refus);
  }

  console.log('\n2) Déclarer : l\'annonce part dans TOUS les salons retenus');
  {
    const monde = fauxMonde();
    const panneau = monde.creerSalon('C1');
    const annonces1 = monde.creerSalon('A1');
    const annonces2 = monde.creerSalon('A2');
    panneau.guildId = 'G1';
    await absences.publierPanneau(panneau, [annonces1, annonces2]);
    V('le panneau est publié avec son bouton', panneau.envois.length === 1 && panneau.envois[0].components?.length === 1);

    const decl = fausseInteraction(monde, { champs: { 'abs:debut': '', 'abs:fin': '2j', 'abs:raison': 'Examens' } });
    await absences.handleModal(decl);
    V('une copie dans chaque salon d\'annonces', annonces1.envois.length === 1 && annonces2.envois.length === 1);
    V('… pas dans le salon du panneau (non retenu)', panneau.envois.length === 1);
    V('la confirmation est éphémère et compte les salons', /2 salon/.test(decl.reponses[0]?.content) && decl.reponses[0]?.flags);
    const encours = absences.enCours('G1');
    V('l\'absence est en base', encours.length === 1 && encours[0].raison === 'Examens');

    const redecl = fausseInteraction(monde, { champs: { 'abs:fin': '3j' } });
    await absences.handleModal(redecl);
    V('une seconde déclaration est refusée tant que la première court',
      /déjà une absence en cours/.test(redecl.reponses[0]?.content), redecl.reponses[0]?.content);
    const bouton = fausseInteraction(monde, {});
    bouton.customId = 'abs:ouvrir';
    await absences.handleBouton(bouton);
    V('… et le bouton le dit AVANT d\'ouvrir la modale', /déjà une absence en cours/.test(bouton.reponses[0]?.content));
  }

  console.log('\n3) « Je suis de retour » : tout s\'efface, mais pas pour n\'importe qui');
  {
    const monde = fauxMonde();
    const a1 = monde.creerSalon('A1');
    const a2 = monde.creerSalon('A2');
    const panneau = monde.creerSalon('C1');
    panneau.guildId = 'G1';
    await absences.publierPanneau(panneau, [a1, a2]);
    const decl = fausseInteraction(monde, { user: 'U2', champs: { 'abs:fin': '' } });
    await absences.handleModal(decl);
    const idMessage = a1.envois[0].id;

    const intrus = fausseInteraction(monde, { user: 'U3', messageId: idMessage });
    intrus.customId = 'abs:fin';
    await absences.handleBouton(intrus);
    V('un tiers ne peut pas clore l\'absence d\'un autre', /⛔/.test(intrus.reponses[0]?.content), intrus.reponses[0]?.content);
    V('… rien n\'est supprimé', a1.supprimes.length === 0 && a2.supprimes.length === 0);

    const staff = fausseInteraction(monde, { user: 'U3', membreStaff: true, messageId: idMessage });
    staff.customId = 'abs:fin';
    await absences.handleBouton(staff);
    V('le staff, lui, peut', /supprimées/.test(staff.reponses[0]?.content), staff.reponses[0]?.content);
    V('TOUTES les copies sont supprimées', a1.supprimes.length === 1 && a2.supprimes.length === 1);
    V('et l\'absence quitte la base', absences.enCours('G1').filter((a) => a.user_id === 'U2').length === 0);
  }

  console.log('\n4) Le balayage : l\'annonce se supprime quand l\'absence est finie');
  {
    const monde = fauxMonde();
    const a1 = monde.creerSalon('A1');
    const panneau = monde.creerSalon('C1');
    panneau.guildId = 'G1';
    await absences.publierPanneau(panneau, [a1]);

    // Une absence d'une heure… déclarée comme finie il y a une minute, en
    // trichant sur la base — exactement ce qu'un redémarrage raterait.
    const decl = fausseInteraction(monde, { user: 'U4', champs: { 'abs:fin': '1h' } });
    await absences.handleModal(decl);
    const { db } = require('../src/database');
    db.prepare('UPDATE absences SET fin = ? WHERE user_id = ?').run(Date.now() - 60_000, 'U4');

    const fermees = await absences.balayer(monde.client);
    V('le balayage ferme l\'absence échue', fermees === 1);
    V('… et supprime son annonce', a1.supprimes.length === 1);
    V('… et la base est propre', absences.enCours('G1').filter((a) => a.user_id === 'U4').length === 0);

    const indeterminee = fausseInteraction(monde, { user: 'U5', champs: { 'abs:fin': '' } });
    await absences.handleModal(indeterminee);
    await absences.balayer(monde.client);
    V('une absence indéterminée n\'est JAMAIS balayée', absences.enCours('G1').some((a) => a.user_id === 'U5'));
  }

  console.log('\n5) Une fin déjà passée est refusée avant d\'écrire quoi que ce soit');
  {
    const monde = fauxMonde();
    monde.creerSalon('C1');
    const decl = fausseInteraction(monde, { user: 'U6', champs: { 'abs:debut': '01/01/2020', 'abs:fin': '02/01/2020' } });
    await absences.handleModal(decl);
    V('le refus nomme le problème', /déjà finie/.test(decl.reponses[0]?.content), decl.reponses[0]?.content);
    V('rien en base', absences.enCours('G1').filter((a) => a.user_id === 'U6').length === 0);
  }

  console.log('\n6) Branchements');
  {
    const ic = fs.readFileSync(`${__dirname}/../src/events/interactionCreate.js`, 'utf8');
    V('les boutons abs: et la modale sont routés', /abs:/.test(ic) && /abs:decl/.test(ic));
    const rd = fs.readFileSync(`${__dirname}/../src/events/ready.js`, 'utf8');
    V('le balayage démarre avec le bot', /absences'\)\.demarrer\(client\)/.test(rd));
    const cmd = fs.readFileSync(`${__dirname}/../src/commands/absence.js`, 'utf8');
    V('la déclaration est ouverte à tous, la publication au staff',
      /GRADES\.EVERYONE/.test(cmd) && /GRADES\.STAFF/.test(cmd));
    V('jusqu\'à trois salons d\'annonces', /annonces3/.test(cmd));
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})();
