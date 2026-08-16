# Direction artistique — à respecter pour TOUT nouvel embed

## 0. On n'envoie plus d'embeds : on envoie des cartes

Un embed Discord traîne toujours une barre verticale colorée collée à son bord
gauche. Elle n'est pas réglable : elle **est** le composant. Aucune couleur,
aucun filet, aucune mise en page ne l'enlève.

`src/utils/cartes.js` convertit donc chaque embed en **conteneur de composants**
(« Components V2 ») au moment de l'envoi, sur la couche réseau :

| Embed | Carte |
|---|---|
| barre colorée à gauche | rien, sauf `embed_bordure = accent` |
| `─────` dessiné à la main | vrai séparateur tracé par Discord |
| `title` | `# Titre` — en grand, il ouvre la carte |
| `author` / `footer` | `-# sous-texte` |
| `thumbnail` | accessoire d'une section |
| `image` | galerie |
| `timestamp` | `<t:…:f>`, à l'heure de chaque lecteur |

La tête de carte suit la référence : **rien au-dessus du titre**. Comme
l'identité écrit déjà `NomDuBot • NomDuServeur` en pied, une ligne d'auteur
qui répète le nom du serveur ne dirait la même chose qu'une deuxième fois tout
en écrasant le titre — elle est donc retirée. Une ligne d'auteur porteuse de
sens (`Avis de @membre`) est conservée.

### Le tableau de bord partage le moteur, il ne l'imite pas

`src/utils/{identite,cartes,balises}.js` tournent **aussi dans le navigateur**.
`./scripts-publier-moteur.sh` les copie vers `site-php/assets/js/moteur-*.js`,
et un test échoue si les copies diffèrent d'un seul octet.

C'est ce qui permet de promettre « ce que tu écris dans l'aperçu est
exactement ce qui part ». Deux implémentations du rendu finiraient par
diverger, et l'aperçu mentirait.

Ces trois fichiers ne doivent donc **jamais** exiger quoi que ce soit de Node
— ni `require`, ni base de données. Les réglages arrivent en argument. Et
comme ils partagent la portée globale du navigateur, aucun nom de premier
niveau ne doit être commun aux trois (un test le vérifie : trois `const API`
avaient déjà suffi à empêcher la page de se charger).

Trois règles à ne jamais enfreindre :

- **Seuls les ENVOIS sont convertis, jamais les modifications.** Discord fige
  la famille de composants d'un message à sa création : un embed ne devient
  pas une carte par `edit()`. Pour l'existant, `/esthetique appliquer
  mode:recréer` républie — et perd réactions, réponses, liens et date.

  Conséquence à ne jamais oublier : `deferReply` **crée déjà le message**.
  Répondre ensuite par `editReply` donne donc forcément un embed à l'ancienne,
  barre colorée comprise. Toute commande qui diffère sa réponse doit passer
  par `repondre()` (`src/utils/reponse.js`), qui referme le message d'attente
  et envoie le contenu en `followUp` — un envoi, donc converti.

  | Appel | Route | Converti ? |
  |---|---|---|
  | `reply()` | POST `/interactions/…/callback` | ✅ |
  | `followUp()` | POST `/webhooks/…` | ✅ |
  | `editReply()` | PATCH `/webhooks/…/@original` | ❌ jamais |

  La seule exception légitime est un aperçu qui se rafraîchit en boucle
  (l'éditeur d'IA) : le convertir enverrait un message par frappe.
- **Toujours un repli.** Si l'API refuse (code 400), on rejoue la requête
  d'origine. Un message dans l'ancien style vaut infiniment mieux qu'aucun
  message. Après trois refus, on cesse d'insister.
- **Jamais de troncature silencieuse.** Au-delà de 4000 signes de texte ou 40
  composants, on renonce à convertir et on garde l'embed complet.

Cette DA est la règle du projet. Tout ajout, toute commande, tout message
du bot la suit — sans exception et sans qu'on ait à le redemander.

## 1. Identité, toujours présente

Posée automatiquement sur la couche réseau (`src/utils/styleEmbeds.js`), donc
valable pour **tout** ce que le bot envoie : salon, réponse de commande,
message privé, webhook. Rien à faire dans le code d'une nouvelle commande.

| Élément | Valeur |
|---|---|
| Couleur | accent du serveur (`embed_accent`) |
| Ligne d'auteur | nom + icône du serveur |
| Pied de page | `NomDuBot • NomDuServeur` + icône |
| Horodatage | l'heure d'envoi |
| Filet | une ligne fine sous le titre (`embed_ligne`) |
| Bannière | image large en bas de carte (`embed_banniere`) |
| Champs | refondus en sections `◆` / `➜` (`embed_fusion`) — la grille de champs de Discord n'appartient PAS à la DA |

**Ne jamais écraser ce qui porte du sens.** Une couleur posée volontairement
(rouge = sanction, vert = réussite), un pied de page utile (`Page 2/4`,
`Relancé par X`) et une ligne d'auteur parlante (`Avis de @membre`) sont
conservés tels quels. L'identité ne comble que le vide.

**Mais une couleur neutre EST du vide.** Le bleu de Discord (`0x5865f2`), le
bleu « info » (`0x3498db`), les gris de carte, le noir et le blanc ne sont pas
des décisions : ce sont des valeurs posées faute de mieux. `styleEmbeds` les
reconnaît (`COULEURS_NEUTRES`) et pose l'accent du serveur à la place.
`COLORS.PRIMARY` et `COLORS.INFO` sont dans ce cas ; `SUCCESS`, `DANGER` et
`WARNING` portent un sens et ne bougent jamais.

C'est ce point, et lui seul, qui faisait que « tout le monde utilise encore
les vieilles embeds » : l'identité voyait une couleur, la croyait choisie, et
n'y touchait pas.

**Un pied de page décoratif est pire que pas de pied de page.** `Note de mise
à jour du bot` sous un titre `📝 Note de mise à jour` ne dit rien de neuf et
prend la place de la signature. Un pied de page ne s'écrit que s'il ajoute une
information : une page, un auteur, une date, un compte.

## 1 bis. Balises — le texte libre écrit par les membres

`src/utils/balises.js`. Partout où quelqu'un écrit du texte (message
d'accueil, de départ, panneau de tickets, réponse type, éditeur d'embed), le
texte passe par `balises.appliquer()`.

| Tapé en début de ligne | Résultat |
|---|---|
| `&&` | une barre |
| `&& Titre` | une barre puis `◆ **Titre**` |
| `&&&` | une barre avec plus d'air |
| `&> Texte` | `➜ Texte` |
| `\n` | un retour à la ligne |

La barre écrite est le **même filet** que celui de l'identité : en mode carte,
`cartes.js` le reconnaît et le remplace par un séparateur natif. Une seule
mécanique, les deux rendus.

Trois règles à ne pas casser :

- **Début de ligne uniquement**, et jamais dans un bloc de code ` ``` `. Sinon
  un `if (a && b)` dans une réponse type serait coupé en deux.
- **Les balises AVANT les variables.** Un pseudo contenant `&&` ne doit pas
  devenir une barre.
- **Aucune barre qui ne sépare rien** : en tête, en queue ou en double, elle
  est retirée.

## 2. Grammaire des listes

Utiliser `src/utils/miseEnPage.js` — ne pas réinventer la mise en forme.

```
◆ 🛡️ · **Gérant Staff** • 2 membres
➜ @GS | Bayouss
➜ @GS | Leen
────────────────────────────
◆ 📘 · **Gérant RP Légal** • 0 membre
*Aucun membre*
```

- `entete(titre, { prefixe, compte })` → la ligne `◆`
- `entree(texte)` → la ligne `➜`
- `bloc(titre, entrees, { prefixe, vide })` → en-tête + entrées, ou l'état
  vide en *italique*
- `description(blocs)` → assemble avec le séparateur
- `paginer(blocs)` → découpe **entre** deux blocs, jamais au milieu
- `boutonsPages(id, page, pages)` → ⏮️ / ⏭️, grisés aux extrémités

Marqueur d'entrée : **`➜`**, jamais `•` ni `-`.

## 3. Pied de page des listes

`piedDePage({ total, motTotal, page, pages, extra })` →
`1972 membres • Mis à jour à 16:07 • Page 1/2`

Toujours dans cet ordre, toujours au même endroit.

## 4. Fiches et statistiques

- `etoiles(note)` → `★★★★☆`
- `citation(texte)` → le texte d'un membre, préfixé `>` **ligne par ligne**.
  **Jamais `>>>`** : cette citation s'étend jusqu'à la fin du message et
  avale tout ce qui suit (c'est ce qui collait l'« Après » au « Avant » dans
  les logs).
- `statistique(label, valeur, detail)` → `Moyenne : **4.1/5** *(sur 81 avis)*`
- Un avant/après ou plusieurs textes distincts → des **champs d'embed**
  séparés, pas une description à rallonge.

## 5. Limites Discord à ne pas franchir

| Quoi | Maximum |
|---|---|
| Description | 4096 caractères |
| Valeur d'un champ | 1024 |
| Champs | 25 |
| Rangées de composants | 5 |
| Options d'un menu | 25 |
| Embeds par message | 10 |
| Identifiant de composant | 100 caractères |

Au-delà : paginer (`paginer`) ou couper proprement (`borner`), jamais
tronquer au milieu d'une entrée.

## 6. Rattraper l'existant

`/esthetique appliquer` **reconstruit** les messages **déjà envoyés** par le
bot : champs refondus en sections, filet, bannière, couleur, ligne d'auteur,
signature. Le vieil embed sert de réserve d'informations — chaque mot est
conservé, seule la forme change. Résultat attendu : un ancien message devient
rigoureusement identique à un message envoyé aujourd'hui. À proposer après
tout changement d'accent.

La reconstruction se fait **par modification, jamais par suppression suivie
d'un renvoi**. Un bot peut réécrire intégralement ses propres embeds : le
résultat visuel est le même, mais republier détruirait les réactions, les
épingles, les réponses accrochées, les liens partagés vers le message et sa
date d'origine — et remonterait de vieux messages en bas des salons.

Deux pièges déjà payés, à ne pas refaire :
- **Filets périmés.** Un message publié à l'époque d'un filet plus long garde
  son trait tant qu'on ne le normalise pas — c'est ce qui donne l'impression
  que « rien n'a changé ». Toute ligne faite uniquement de `─` est un filet :
  la remettre à la longueur du jour.
- **Ordre des clés JSON.** Effacer une signature périmée puis la réécrire la
  renvoie en fin d'objet. Comparer les textes JSON bruts conclurait « ça a
  changé » à chaque passage. Comparer avec des clés triées.

**Réservée au créateur du bot**, et **sans choix de salon** : l'esthétique
appartient au bot, pas à un serveur. La commande balaye donc tous les
serveurs où le bot est présent, en relisant les réglages propres à chacun
et en laissant tel quel celui qui a coupé l'identité.

Un bot ne peut modifier que **ses propres** messages : ceux des membres ou
d'un autre bot ne sont pas rattrapables, et la commande le dit.

## 7. Ton des textes

Français, phrases courtes, une idée par ligne. Un emoji en tête de section
pour l'orientation visuelle — pas de décoration gratuite. Les messages
d'erreur disent **ce qui s'est passé et quoi faire**, jamais « une erreur
est survenue » tout court.
