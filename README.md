# OSINT & Privacy Suite

![Platform](https://img.shields.io/badge/Platform-macOS%20arm64%20(Apple%20Silicon)-0f172a?style=for-the-badge&logo=apple)
![Electron](https://img.shields.io/badge/Electron-45.x-47848F?style=for-the-badge&logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/Storage-Native%20node%3Asqlite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-437%20Passing-10b981?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-3b82f6?style=for-the-badge)

Application de bureau native pour macOS qui centralise, exécute en parallèle et restitue visuellement les résultats de six outils majeurs de reconnaissance **OSINT** et d'audit d'empreinte numérique, couplée aux bases **JustDeleteMe**, **JustGetMyData**, à un moteur de **Score Global de Risque**, un **Comparateur Chronologique d'Audits**, un **Exportateur de Rapports HTML/PDF** et un générateur juridique de demandes d'effacement conformes à l'**Article 17 du RGPD**.

---

## À quoi sert ce projet ?

Plutôt que d'exécuter manuellement plusieurs outils en ligne de commande dans un terminal et de croiser les résultats à la main, cette application offre une interface graphique unifiée permettant de :
1. **Cartographier son empreinte numérique** en lançant simultanément 6 moteurs d'analyse OSINT à partir d'une seule saisie (adresse email, pseudonyme, numéro de téléphone).
2. **Reprendre le contrôle sur ses données personnelles** en identifiant immédiatement comment supprimer chaque compte détecté (**JustDeleteMe**), comment récupérer une archive de ses données (**JustGetMyData**) ou comment envoyer une mise en demeure d'effacement conforme au **RGPD (Article 17)**.
3. **Conserver son historique d'audit 100 % en local** dans une base SQLite embarquée sur le poste utilisateur, sans aucune télémétrie ni transmission vers un serveur tiers.

---

## Fonctionnalités et Organisation des 4 Vues

### Vue 1 : Accueil et Lancement Unifié
* **Saisie multi-cibles unique** : renseignez simultanément une adresse électronique, un pseudonyme et un numéro de téléphone (avec sélecteur d'indicatif international).
* **Orchestration parallèle asynchrone** : exécution simultanée des outils sélectionnés avec barre de progression en temps réel, statut individuel par outil, gestion des délais d'expiration (`timeout`) et bouton d'arrêt d'urgence.
* **Normalisation et dédoublonnage** : fusion automatique des résultats hétérogènes au sein de modèles de données unifiés (`UnifiedAccount` et `UnifiedLeak`).

### Vue 2 : Audit de Vie Privée, Score de Risque et Nettoyage de Comptes
* **Score Global de Risque (`0` à `100`) et Jauge SVG** : évaluation pondérée en temps réel de l'exposition numérique (selon le nombre de comptes non résolus, la difficulté de suppression et la criticité des fuites de mots de passe) accompagnée d'un plan d'action hiérarchisé en 4 niveaux de priorité.
* **Export de Rapport d'Audit Complet (HTML & PDF)** : génération en un clic d'un rapport d'audit autonome mis en page pour l'impression et l'archivage hors ligne, intégrant la jauge vectorielle, les recommandations et l'inventaire complet des comptes et fuites.
* **Réconciliation JustDeleteMe (plus de 2 660 plateformes)** : indexation locale et algorithme de correspondance en cascade (alias canoniques, domaine exact, domaine racine, nom normalisé) attribuant automatiquement le badge de difficulté de suppression (*Facile*, *Moyen*, *Difficile*, *Impossible*, *Conditionnel*).
* **Intégration JustGetMyData** : accès direct aux portails officiels d'exportation et de portabilité des données personnelles.
* **Générateur de Demande d'Effacement RGPD (Article 17)** : rédaction instantanée d'un courriel juridique prérempli avec les identifiants du compte détecté, prêt à être copié ou ouvert dans le client de messagerie (`mailto:`).
* **Suivi d'assainissement persistant** : cases à cocher synchronisées en temps réel avec la base SQLite locale et recalcul immédiat du score de risque et du taux d'assainissement.

### Vue 3 : Exploration OSINT Approfondie par Onglets
* **Holehe** (`holehe <email> --only-used`) : vérifie sur quels services web une adresse électronique est enregistrée.
* **Maigret** (`maigret <pseudo> --html`) : recherche un pseudonyme sur plus de 2 500 plateformes, extrait les métadonnées publiques et permet d'ouvrir le rapport visuel HTML.
* **Ignorant** (`ignorant <indicatif> <numero> --only-used`) : vérifie sur quelles applications et messageries un numéro de téléphone est utilisé.
* **GHunt** (`ghunt email <email>`) : extrait les informations publiques associées à un compte Google (Gaia ID, profil, services actifs).
* **h8mail** (`h8mail -t <email>`) : recherche une adresse électronique dans les fuites et brèches de bases de données.
* **SpiderFoot** (`sf.py`) : automatise le croisement et la corrélation passive sur plus de 200 sources OSINT.

### Vue 4 : Dossiers Locaux, Comparateur d'Historique, Diagnostic et Paramètres
* **Comparateur Chronologique d'Audits** : comparaison différentielle entre deux audits sauvegardés à des dates différentes pour visualiser l'évolution du score de risque et distinguer les **nouveaux comptes exposés**, les **comptes persistants** et les **comptes résolus ou supprimés**.
* **Historique local SQLite et Exports Directs** : sauvegarde, rechargement, export HTML/PDF direct et suppression des sessions d'audit antérieures (comptes, fuites et demandes RGPD).
* **Portabilité JSON** : exportation et importation atomique de dossiers complets au format JSON.
* **Diagnostic de santé des outils en 1 clic** : détection automatique des binaires CLI installés, de leur version et de leur chemin d'exécution.

### Ergonomie Adaptative (Responsive Design) et Thèmes Visuels
* **Adaptation fluide multi-résolutions (`380px` à `UltraWide`)** : mise en page CSS Grid et Flexbox s'adaptant sans aucun débordement horizontal depuis les fenêtres compactes en écran partagé (`380px` / `400px`) jusqu'aux moniteurs grand format.
* **Thème Sombre et Thème Clair** : bascule instantanée dans l'en-tête avec contraste certifié WCAG AA et mémorisation locale de la préférence utilisateur.

---

## Architecture Logicielle et Séparation des Couches Métiers

Le projet respecte une séparation stricte des responsabilités (*Clean Layered Architecture*) en trois couches indépendantes :

```text
osint_privacy_suite/
├── src/
│   ├── core/                   # Couche Métier (Domaine, Orchestration & Adaptateurs)
│   │   ├── adapters/           # Wrappers CLI isolés (Holehe, Maigret, Ignorant, h8mail, GHunt, SpiderFoot)
│   │   ├── orchestrator.ts     # Moteur d'exécution parallèle, streaming d'événements et gestion des signaux
│   │   ├── normalizer.ts       # Normalisation et dédoublonnage inter-outils
│   │   ├── jdm-matcher.ts      # Moteur d'indexation et de réconciliation JustDeleteMe
│   │   ├── jgmd-matcher.ts     # Résolveur de portails d'export de données JustGetMyData
│   │   ├── gdpr-generator.ts   # Générateur juridique conforme à l'Article 17 du RGPD
│   │   ├── risk-engine.ts      # Calculateur pondéré du score de risque (0-100) et recommandations
│   │   ├── report-exporter.ts  # Générateur de rapports d'audit autonomes HTML/PDF avec jauge SVG
│   │   ├── audit-comparator.ts # Comparateur différentiel chronologique entre deux audits
│   │   └── types.ts            # Contrats de données et interfaces TypeScript strictes
│   ├── storage/                # Couche Persistance (Accès aux données locales)
│   │   ├── database.ts         # Moteur relationnel SQLite natif (node:sqlite, transactions atomiques, WAL)
│   │   └── json-store.ts       # Sérialisation et validation stricte des imports/exports JSON
│   ├── main/                   # Couche Processus Principal Electron
│   │   ├── index.ts            # Cycle de vie de la fenêtre native (minWidth 380px) et sécurité
│   │   ├── ipc-handlers.ts     # Contrôleurs IPC (19 canaux typés) et liste blanche de protocoles
│   │   └── pdf-renderer.ts     # Rendu PDF natif isolé hors écran via webContents.printToPDF
│   ├── preload/                # Pont de Sécurité Isolé
│   │   └── index.ts            # Exposition restreinte via contextBridge (window.electronAPI)
│   └── renderer/               # Couche Présentation (Interface Utilisateur)
│       ├── index.html          # Structure sémantique des 4 vues, jauge SVG, comparateur et modale RGPD
│       ├── app.ts              # Logique réactive du tableau de bord et gestion des thèmes
│       └── styles/main.css     # Système de design adaptatif (380px à UltraWide) sombre et clair
├── data/
│   └── jdm_sites.json          # Base locale embarquée de plus de 2 660 sites JustDeleteMe
├── scripts/
│   ├── copy-assets.js          # Copie des ressources statiques du Renderer
│   └── build-dmg.js            # Assemblage du bundle macOS .app, signature ad-hoc et génération du .dmg
└── tests/
    ├── unit/                   # Suite de tests unitaires et contradictoires (Vitest)
    └── e2e/                    # Harnais de validation de bout en bout en 4 tiers
```

---

## Normes de Développement et de Sécurité

### Sécurité Applicative (Defense in Depth)
1. **Isolation stricte du contexte Electron** : configuration systématique avec `contextIsolation: true` et `nodeIntegration: false`. L'interface graphique n'a aucun accès direct aux primitives Node.js ni au système de fichiers.
2. **Prévention des injections de commandes** : tous les outils CLI sont exécutés via `child_process.spawn(binary, argsArray)` sans interpréteur shell (`shell: false`), neutralisant toute injection de métacaractères shell.
3. **Gestion du cycle de vie des processus (Anti-Zombies)** : suivi actif des PID enfants avec arrêt gracieux par `SIGTERM` suivi d'une escalade garantie vers `SIGKILL` en cas de délai dépassé ou d'annulation utilisateur.
4. **Protection contre les injections XSS** : échappement systématique de toutes les données issues des sorties d'outils externes avant insertion dans le DOM.
5. **Liste blanche de protocoles externes** : le canal `shell:openExternal` valide formellement chaque URL et n'autorise que `https:`, `http:` et `mailto:` (bloquant `file:`, `javascript:`, `data:`).
6. **Requêtes SQLite préparées** : 100 % des accès à la base locale utilisent des requêtes paramétrées compilées (`db.prepare()`), rendant toute injection SQL impossible.

### Qualité Logicielle et Standards d'Ingénierie
* **Typage statique strict** : écrit intégralement en TypeScript (`strict: true`) avec contrats d'interfaces explicites entre les couches.
* **Zéro dépendance native fragile** : utilisation du moteur standard `node:sqlite` intégré nativement au runtime Node/Electron en mode `WAL` (*Write-Ahead Logging*) avec transactions atomiques.
* **Validation automatisée multi-niveaux (437 tests)** :
  * **257 tests unitaires et de stress** (Vitest) : adaptateurs, normaliseur, correspondances JustDeleteMe, moteur de score de risque, exportateur de rapport HTML/PDF, comparateur d'audits, concurrence IPC et élimination des processus orphelins.
  * **133 tests de bout en bout (E2E)** répartis en 4 tiers : couverture fonctionnelle (Tier 1), limites et cas aux bornes (Tier 2), combinaisons croisées et dédoublonnage (Tier 3), scénarios réels complets (Tier 4).
  * **47 contre-épreuves DOM et Shell Electron** : stress de navigation haute fréquence, validation multi-résolutions sur 7 largeurs d'écran (`380px` à `1920px`), bascule rapide de thème, charges utiles de 10 000 caractères et vecteurs XSS.

---

## Installation et Exécution

### 1. Via l'image disque macOS (`.dmg`)
1. Générer l'image disque avec `npm run build:dmg` (ou ouvrir directement le fichier `OSINT-Privacy-Suite-1.0.0-arm64.dmg`).
2. Glisser **OSINT Privacy Suite.app** dans le dossier **Applications**.

### 2. Depuis les sources

#### Prérequis
* **macOS** (Apple Silicon `arm64`)
* **Node.js** `>= 22.5.0`
* Outils CLI Python installés dans `~/.local/bin` ou `/opt/homebrew/bin` (`pipx install holehe maigret ignorant h8mail ghunt`)

#### Commandes

```bash
# Installer les dépendances
npm install

# Compiler le code TypeScript et les ressources graphiques
npm run build

# Lancer l'application en mode bureau
npm start

# Générer le paquet macOS (.app) et l'installateur (.dmg) dans release/
npm run build:dmg
```

---

## Exécution des Suites de Tests

```bash
# Tests unitaires et contradictoires (257 tests)
npm run test:unit

# Harnais de tests E2E en 4 tiers (133 tests)
npm run test:e2e

# Validation automatisée headless du conteneur Electron
npm run test:headless
```

---

## Licence

Distribué sous licence **MIT**.
