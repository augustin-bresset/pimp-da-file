# open-pdf

Outil PDF 100 % navigateur : aucun serveur, aucun envoi — vos fichiers ne quittent jamais l'onglet.
Rendu des pages par [pdf.js](https://mozilla.github.io/pdf.js/), manipulation par [pdf-lib](https://pdf-lib.js.org/).

## Fonctions

- **Fusionner** — plusieurs PDF en un seul, ordre réglable (glisser-déposer).
- **Diviser** — placer des découpes ✂ entre les pages (téléchargement en .zip),
  ou sélectionner des pages à extraire dans un nouveau PDF.
- **Éditer** — ajouter du texte, ajouter une image (PNG/JPEG), masquer une zone
  (rectangle blanc), et remplir les champs de formulaire pour les PDF qui en
  contiennent (avec option d'aplatissement).

## Lancer en local

```bash
./open-pdf.sh          # construit si besoin, sert dist/ et ouvre le navigateur
```

Développement :

```bash
npm install
npm run dev            # serveur Vite avec rechargement à chaud
npm run build          # tsc --noEmit + build de production dans dist/
```

## Déployer sur Render (accès depuis n'importe quel appareil)

L'app est un site statique — le palier gratuit de Render suffit.

1. Poussez ce dépôt sur GitHub (ou GitLab).
2. Sur [dashboard.render.com](https://dashboard.render.com) : **New → Blueprint**,
   sélectionnez le dépôt — le fichier `render.yaml` configure tout
   (build `npm install && npm run build`, publication de `dist/`).
3. L'app est servie sur `https://open-pdf-<xxxx>.onrender.com`.

Alternativement : **New → Static Site**, build command `npm install && npm run build`,
publish directory `dist`.

## Limites connues

- L'édition ajoute des calques (texte, image, masque) par-dessus le contenu ;
  le texte existant d'un PDF aplati ne peut pas être modifié en place —
  utilisez « Masquer » puis « Texte » pour le remplacer visuellement.
- Les pages pivotées (métadonnée /Rotate) peuvent placer les ajouts de biais.
- Les PDF chiffrés par mot de passe ne sont pas pris en charge.
- Texte ajouté : police Helvetica, jeu de caractères Latin-1 (accents français inclus).
