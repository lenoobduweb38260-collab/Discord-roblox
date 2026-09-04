const crypto = require('crypto');
const { db } = require('../database');

const ALPHANUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomString(length, alphabet) {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const cardExists = db.prepare('SELECT 1 FROM identity_cards WHERE card_id = ?');
const permitExists = db.prepare('SELECT 1 FROM permits WHERE permit_number = ?');

// ID de carte au format CNI-XXXXXXXX (unique).
function generateCardId() {
  let id;
  do {
    id = `CNI-${randomString(8, ALPHANUM)}`;
  } while (cardExists.get(id));
  return id;
}

// Numéro de permis à 12 chiffres, groupés par 4 (unique).
function generatePermitNumber() {
  let num;
  do {
    const digits = randomString(12, '0123456789');
    num = `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`;
  } while (permitExists.get(num));
  return num;
}

module.exports = { generateCardId, generatePermitNumber };
