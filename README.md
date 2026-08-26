# open-pdf

Outil PDF 100 % navigateur : aucun serveur, aucun envoi — vos fichiers ne quittent jamais l'onglet.
Rendu des pages par [pdf.js](https://mozilla.github.io/pdf.js/), manipulation par [pdf-lib](https://pdf-lib.js.org/).

## Fonctions

- **Fusionner** — plusieurs PDF en un seul, ordre réglable (glisser-déposer).
- **Diviser** — placer des découpes ✂ entre les pages (téléchargement en .zip),
  ou sélectionner des pages à extraire dans un nouveau PDF.
- **Éditer** —
  - **Retoucher** : modifier le texte existant *directement dans le PDF*
    quand la police le permet (encodage simple type WinAnsi) ; sinon un
    remplacement visuel (masque + texte) est appliqué automatiquement,
    avec annulation possible ;
  - ajouter du texte, ajouter une image (PNG/JPEG), masquer une zone
    (rectangle blanc) ;
  - remplir les champs de formulaire pour les PDF qui en contiennent
    (avec option d'aplatissement) ;
  - zoom avant/arrière et ajustement à la fenêtre ;
  - annuler / rétablir : boutons ↶ ↷ ou **Ctrl+Z** / **Ctrl+Maj+Z** (⌘ sur Mac),
    couvrant retouches, ajouts, suppressions et déplacements.

L'interface s'adapte au mobile (barre d'outils compacte, cibles tactiles
élargies) et l'app est installable sur l'écran d'accueil une fois déployée
(manifeste web fourni).

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

- « Retoucher » modifie le PDF en place pour les polices simples à encodage
  inversible (WinAnsi, différences AGL) ; les polices composites (CID/Type0,
  sous-ensembles) et le texte dans des XObjects basculent en remplacement
  visuel. Le texte qui suit sur la ligne ne se recale pas si la longueur change.
- Les pages pivotées (métadonnée /Rotate) peuvent placer les ajouts de biais.
- Les PDF chiffrés par mot de passe ne sont pas pris en charge.
- Texte ajouté : police Helvetica, jeu de caractères Latin-1 (accents français inclus).
