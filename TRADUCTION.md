# 🌍 Traduire le bot

## Ce qu'il y a à faire

`traductions.csv` — **2 401 lignes**, à ouvrir dans Excel, LibreOffice ou
Google Sheets. Une ligne par texte affiché par le bot.

| Colonne | À quoi elle sert |
|---|---|
| `Cle` | Repère interne. **Ne pas y toucher.** |
| `Fichier` / `Ligne` | Où le texte se trouve dans le code, si un doute sur le contexte |
| `A NE PAS TRADUIRE` | Voir plus bas ⚠️ |
| `Francais (source)` | Le texte d'origine. **Ne pas le modifier** : c'est lui qui sert de clé |
| `English` | **Déjà rempli** — le bot est entièrement traduit en anglais |
| `Deutsch` `Russe` `Espagnol` | À remplir |

État : **2 395 traduits en anglais (la totalité)**, 6 intraduisibles,
**2 395 à faire** dans chacune des trois autres langues.

La colonne anglaise sert de **deuxième source** : quand une tournure
française est ambiguë, la version anglaise dit comment elle a été comprise.

## ⚠️ La colonne « A NE PAS TRADUIRE »

6 lignes portent `OUI — valeur technique, laisser tel quel`.

Ce ne sont pas des phrases : ce sont des **valeurs** que le code compare.
« Rôle staff » ou « Salon mises à jour » sont des clés de réglage lues telles
quelles. Les traduire casserait la fonction **sans le moindre message
d'erreur** — le bot continuerait de tourner en ne reconnaissant plus rien.

Leur colonne est déjà remplie avec le français. Laissez-la ainsi.

## Comment traduire

- **Gardez les émojis** à leur place : `✅ Valide` → `✅ Valid`.
- **Gardez la mise en forme** : `**gras**`, `` `code` ``, `-# petit texte`.
- **Gardez les balises du bot** : une ligne commençant par `&&` trace une
  barre, `&>` une entrée de liste. Elles se placent en début de ligne.
- **Gardez les variables** : `{nom}`, `{titre}`, `{lien}` sont remplacées par
  le bot. Elles s'écrivent pareil dans toutes les langues.
- **Ne traduisez pas les noms de commandes** : `/config`, `/musique play`.
  Ils s'écrivent pareil partout, et les phrases du bot les citent.
- **Les espaces du début et de la fin comptent.** Beaucoup de lignes sont des
  MORCEAUX de phrase : `« > a été ajouté au ticket. »` se colle après un
  pseudo. Enlever l'espace collerait les deux mots.
- `\n` est un saut de ligne. Laissez-le tel quel.
- **Vide = pas traduit**, et le bot affichera le français. C'est prévu : mieux
  vaut une ligne en français qu'une ligne fausse.

## Une fois le fichier rempli

Renvoyez le CSV. Il est converti en `src/utils/traductions.json`, que le bot
lit au démarrage.

```bash
node scripts/importer-traductions.js traductions.csv
```

## Pourquoi les traductions vivent hors du code

Le bot écrit ses textes à 88 endroits. Les reprendre un par un raterait
forcément des cas, et tout nouveau message repartirait en français.

La traduction est donc appliquée **au seul passage obligé** : la couche
réseau, juste avant l'envoi — le même endroit que l'identité visuelle. Deux
conséquences :

1. **Aucune ligne de code à modifier** pour ajouter une langue.
2. Seuls les champs **d'affichage** sont visités. Un identifiant de bouton,
   une valeur d'option, une URL ne sont jamais touchés — c'est ce qui rend le
   fichier sûr à confier.

### Les phrases construites par morceaux

`✅ ${membre} a été ajouté au ticket.` ne figure jamais entière dans le
dictionnaire : à l'exécution elle porte un pseudo au milieu, et elle change à
chaque envoi. Le relevé sort donc les **morceaux fixes** — ici « ✅ » et
« a été ajouté au ticket. » — et le bot les remplace un par un.

C'est pour cela que certaines lignes du fichier commencent ou finissent au
milieu d'une phrase. Traduisez le morceau tel qu'il est, espaces compris.

## Les trois surfaces que le dictionnaire ne couvre pas

Elles sont traduites **dans leur fichier**, et ne figurent donc pas dans le
CSV :

| Où | Pourquoi | Fichier |
|---|---|---|
| `/interact` | Suit la langue Discord de chaque MEMBRE, pas celle du serveur : deux personnes lisent le même message dans deux langues | `src/commands/interact.js` |
| Carte d'identité et permis RP | Dessinés sur une image ; les polices disponibles n'ont ni accents ni cyrillique | `src/utils/carteVisuelle.js` |
| Descriptions des commandes | Enregistrées une fois auprès de Discord, qui les affiche dans la langue du membre | rempli automatiquement depuis le dictionnaire (`src/utils/localiserCommandes.js`) |

## Refaire le relevé après une mise à jour du bot

```bash
node scripts/extraire-textes.js traductions.csv
```

Les traductions déjà faites sont **reportées automatiquement** ; seules les
nouvelles lignes arrivent vides.

Pour savoir ce qui reste :

```bash
node scripts/reste-a-traduire.js de              # combien, par fichier
node scripts/reste-a-traduire.js de utils/tickets.js   # la liste exacte
```
