# Direction artistique — à respecter pour TOUT nouvel embed

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

**Ne jamais écraser ce qui porte du sens.** Une couleur posée volontairement
(rouge = sanction, vert = réussite), un pied de page utile (`Page 2/4`,
`Relancé par X`) et une ligne d'auteur parlante (`Avis de @membre`) sont
conservés tels quels. L'identité ne comble que le vide.

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

`/esthetique appliquer` réhabille les messages **déjà envoyés** par le bot
(couleur, ligne d'identité, signature) sans toucher à leur contenu. À
proposer après tout changement d'accent.

Un bot ne peut modifier que **ses propres** messages : ceux des membres ou
d'un autre bot ne sont pas rattrapables, et la commande le dit.

## 7. Ton des textes

Français, phrases courtes, une idée par ligne. Un emoji en tête de section
pour l'orientation visuelle — pas de décoration gratuite. Les messages
d'erreur disent **ce qui s'est passé et quoi faire**, jamais « une erreur
est survenue » tout court.
