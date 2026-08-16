#!/bin/sh
# Publie vers le tableau de bord les modules de rendu partagés avec le bot.
# COPIE À L'IDENTIQUE, jamais une réécriture : c'est la copie qui garantit que
# l'aperçu du site montre exactement ce que Discord recevra. Un test compare
# les fichiers et échoue à la moindre dérive.
set -e
for m in identite cartes balises; do
  cp "src/utils/$m.js" "site-php/assets/js/moteur-$m.js"
done
echo "✅ moteur de rendu publié : identite, cartes, balises"
