// 📻 Les radios françaises — annuaire public Radio Browser.
//
// Radio Browser (api.radio-browser.info) est un annuaire communautaire et
// gratuit : des dizaines de milliers de stations, dont plusieurs milliers de
// françaises, chacune avec l'URL DIRECTE de son flux. C'est exactement ce
// qu'il faut : pas de clé d'accès, pas de quota, et les flux appartiennent
// aux radios elles-mêmes — l'annuaire ne fait que les répertorier.
//
// Règles de bonne conduite de l'annuaire, respectées ici :
//  • un User-Agent qui dit qui appelle ;
//  • plusieurs miroirs, essayés dans l'ordre — l'annuaire est hébergé par
//    des bénévoles, un miroir peut dormir ;
//  • quand une lecture démarre, on prévient l'annuaire (`/json/url/<uuid>`) :
//    c'est ce qui fait vivre son classement par popularité.
//
// ⚠️ Aucun require de Node ici hors de la portée « fetch » : le module doit
// se charger dans les tests sans réseau — tout appel passe par `appeler()`,
// que les tests remplacent en posant `global.fetch`.

const MIROIRS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];
const AGENT = 'discord-roblox-rp-bot/2.0 (+https://github.com/lenoobduweb38260-collab/Discord-roblox)';
const DELAI_APPEL = 8000;

// Le haut du classement français, gardé une heure : l'autocomplétion tape
// dedans à chaque frappe, on ne va pas re-demander l'annuaire à chaque lettre.
const CACHE_DUREE = 60 * 60 * 1000;
let _cache = { stations: [], depuis: 0 };

// Après une panne TOTALE (aucun miroir), on ne réessaie pas pendant une
// minute : l'autocomplétion appelle à chaque frappe, et chaque balayage des
// miroirs peut durer plusieurs secondes — les frappes s'empileraient.
const PANNE_DUREE = 60 * 1000;
let _panne = 0;

async function appeler(chemin) {
  if (Date.now() - _panne < PANNE_DUREE) {
    throw new Error('L\'annuaire des radios ne répond pas (panne récente). Réessayez dans un instant.');
  }
  let derniere = null;
  for (const miroir of MIROIRS) {
    const controleur = new AbortController();
    // ⚠️ Le minuteur couvre AUSSI la lecture du corps : un miroir qui répond
    // ses en-têtes puis se fige aurait suspendu l'appel pour toujours.
    const minuteur = setTimeout(() => controleur.abort(), DELAI_APPEL);
    try {
      const reponse = await fetch(`${miroir}${chemin}`, {
        headers: { 'User-Agent': AGENT },
        signal: controleur.signal,
      });
      if (!reponse.ok) { derniere = new Error(`HTTP ${reponse.status}`); continue; }
      const corps = await reponse.json();
      _panne = 0;
      return corps;
    } catch (err) {
      derniere = err;
    } finally {
      clearTimeout(minuteur);
    }
  }
  _panne = Date.now();
  throw new Error(`L'annuaire des radios ne répond pas (${derniere?.message || 'aucun miroir joignable'}). Réessayez dans un instant.`);
}

// L'annuaire est rempli par des bénévoles : une vignette « logo.png » ou un
// site « www.radio.fr » sans protocole y traînent. Passés tels quels à
// l'embed, discord.js LÈVE — et la commande entière répondrait « erreur ».
function urlSure(u) {
  try {
    const x = new URL(String(u || ''));
    return (x.protocol === 'http:' || x.protocol === 'https:') ? String(u) : null;
  } catch { return null; }
}

// Ne garder d'une fiche d'annuaire que ce qu'on affiche et ce qu'on joue.
function alleger(s) {
  return {
    uuid: s.stationuuid,
    nom: String(s.name || '').trim().slice(0, 90),
    url: s.url_resolved || s.url || null,
    logo: urlSure(s.favicon),
    genres: String(s.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 4),
    codec: s.codec || null,
    debit: Number(s.bitrate) || 0,
    votes: Number(s.votes) || 0,
    site: urlSure(s.homepage),
  };
}

// 📜 Le haut du classement des radios françaises.
async function francaises() {
  if (_cache.stations.length && Date.now() - _cache.depuis < CACHE_DUREE) return _cache.stations;
  const brutes = await appeler(
    '/json/stations/search?countrycode=FR&hidebroken=true&order=votes&reverse=true&limit=300'
  );
  const stations = (Array.isArray(brutes) ? brutes : []).map(alleger).filter((s) => s.uuid && s.nom && s.url);
  if (stations.length) _cache = { stations, depuis: Date.now() };
  return stations;
}

// Sans accents ni majuscules : « Chérie FM » doit répondre à « cherie ».
const plat = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// 🔎 Pour l'autocomplétion : d'abord le cache, l'annuaire seulement si le
// cache ne suffit pas. Une frappe ne doit jamais attendre un miroir endormi.
async function chercher(texte, limite = 25) {
  const q = plat(texte);
  const base = await francaises().catch(() => _cache.stations);
  const locales = q
    ? base.filter((s) => plat(s.nom).includes(q) || s.genres.some((g) => plat(g).includes(q)))
    : base;
  if (locales.length || !q) return locales.slice(0, limite);

  const brutes = await appeler(
    `/json/stations/search?countrycode=FR&hidebroken=true&order=votes&reverse=true&limit=${limite}&name=${encodeURIComponent(texte)}`
  ).catch(() => []);
  return (Array.isArray(brutes) ? brutes : []).map(alleger).filter((s) => s.uuid && s.nom && s.url);
}

// 🎯 La station derrière un choix d'autocomplétion — ou derrière un texte
// tapé puis envoyé sans rien choisir dans la liste.
async function trouver(valeur) {
  const v = String(valeur || '').trim();
  if (!v) return null;
  if (/^[0-9a-f-]{32,40}$/i.test(v)) {
    const enCache = _cache.stations.find((s) => s.uuid === v);
    if (enCache) return enCache;
    const brutes = await appeler(`/json/stations/byuuid/${encodeURIComponent(v)}`).catch(() => []);
    const s = (Array.isArray(brutes) ? brutes : []).map(alleger).find((x) => x.url);
    if (s) return s;
  }
  const candidates = await chercher(v, 5);
  return candidates[0] || null;
}

// ▶️ L'URL à jouer. On prévient l'annuaire (son classement en vit), et il
// renvoie l'URL résolue ; s'il dort, l'URL de la fiche fait l'affaire.
async function urlDeLecture(station) {
  try {
    const r = await appeler(`/json/url/${encodeURIComponent(station.uuid)}`);
    if (r && r.ok !== false && r.url) return r.url;
  } catch { /* l'annuaire dort : la fiche suffit */ }
  return station.url;
}

// Pour les tests : repartir d'un cache vide.
function reinitialiser() { _cache = { stations: [], depuis: 0 }; _panne = 0; }

module.exports = { francaises, chercher, trouver, urlDeLecture, alleger, reinitialiser, MIROIRS };
