# 🌍 Traduire le bot

## Ce qu'il y a à faire

`traductions.csv` — **1 871 lignes**, à ouvrir dans Excel, LibreOffice ou
Google Sheets. Une ligne par texte affiché par le bot.

| Colonne | À quoi elle sert |
|---|---|
| `Cle` | Repère interne. **Ne pas y toucher.** |
| `Fichier` / `Ligne` | Où le texte se trouve dans le code, si un doute sur le contexte |
| `A NE PAS TRADUIRE` | Voir plus bas ⚠️ |
| `Francais (source)` | Le texte d'origine. **Ne pas le modifier** : c'est lui qui sert de clé |
| `English` `Deutsch` `Russe` `Espagnol` | À remplir |

État actuel : **163 traduits en anglais**, 87 intraduisibles, **1 621 à faire**.

## ⚠️ La colonne « A NE PAS TRADUIRE »

87 lignes portent `OUI — valeur technique, laisser tel quel`.

Ce ne sont pas des phrases : ce sont des **valeurs** que le code compare.
« aucune », « piste » et « file » sont les trois modes de répétition de la
musique ; « Véhicule » est un type d'assurance enregistré en base. Les
traduire casserait la fonction **sans le moindre message d'erreur** — le bot
continuerait de tourner en ne reconnaissant plus rien.

Leur colonne est déjà remplie avec le français. Laissez-la ainsi.

## Comment traduire

- **Gardez les émojis** à leur place : `✅ Valide` → `✅ Valid`.
- **Gardez la mise en forme** : `**gras**`, `` `code` ``, `-# petit texte`.
- **Gardez les balises du bot** : une ligne commençant par `&&` trace une
  barre, `&>` une entrée de liste. Elles se placent en début de ligne.
- **Ne traduisez pas les noms de commandes** : `/config`, `/musique play`.
  Elles s'écrivent pareil dans toutes les langues.
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

## Ajouter le relevé après une mise à jour du bot

```bash
node scripts/extraire-textes.js traductions.csv
```

Les traductions déjà faites sont **reportées automatiquement** ; seules les
nouvelles lignes arrivent vides.
