# 🎾 AUTOPADEL

Bienvenue sur **AUTOPADEL**, l’application web qui simplifie la réservation de terrains de padel !

---

## 🚀 Fonctionnalités principales
- **Authentification** par email et mot de passe
- **Choix du terrain** préféré
- **Sélection de la date et de l’heure**
- **Réservation en avance** (jusqu’à 7 jours)
- **Mode test** pour simuler une réservation

---

## 🗂️ Structure du projet
```
autopadel/
├── public/
│   ├── index.html
│   ├── favicon.ico
│   ├── manifest.json
│   ├── assets/
│   │   └── css/
│   │       └── style.css
│   └── img/
│       └── naderyounan_a_social_media_post_for_Padel_sport_...png
├── server.mjs
├── index.mjs
├── config.js
├── test_app.js
├── logs/
├── old/
├── package.json
└── README.md
```

---

## ⚡ Installation & Lancement
1. **Clonez le dépôt**
   ```sh
   git clone <repository-url>
   cd autopadel
   ```
2. **Installez les dépendances**
   ```sh
   npm install
   ```
3. **Lancez le serveur**
   ```sh
   npm start
   ```
4. **Ouvrez l’application**
   - Rendez-vous sur [http://localhost:3000](http://localhost:3000) (ou le port indiqué dans la console)

---

## 📝 Utilisation
- Remplissez le formulaire avec :
  - Email
  - Mot de passe
  - Terrain préféré
  - Date de réservation
  - Nombre de jours d’avance
  - Plage horaire souhaitée
- (Optionnel) Activez le mode test
- Cliquez sur **Lancer l’autologin** pour réserver

---

## 🔒 Sécurité & Tests
- Un script de test automatique est fourni : `test_app.js`
- Pour vérifier le bon fonctionnement et la sécurité :
  ```sh
  node test_app.js
  ```
- Audit de sécurité des dépendances intégré

---

## 🤝 Contribuer
Les contributions sont les bienvenues ! Ouvrez une issue ou une pull request pour toute suggestion ou amélioration.

---

## 📄 Licence
Projet sous licence MIT. Voir le fichier LICENSE pour plus d’informations.
