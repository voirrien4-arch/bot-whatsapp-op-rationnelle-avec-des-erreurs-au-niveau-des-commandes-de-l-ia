# ChapeauNoir — Bot WhatsApp

Assistant WhatsApp (hacking éthique) multi-connexion par **Mcamara**.
Basé sur [Baileys](https://github.com/WhiskeySockets/Baileys). Connexion par **code d'appairage** (pas besoin de scanner un QR).

---

## Ce qui a été corrigé (v3)

Le problème principal était que **le code d'appairage ne fonctionnait pas**. Causes et corrections :

1. **Code demandé trop tôt** → générait un "code mort" refusé par WhatsApp.
   ✅ Le code est maintenant demandé une fois le socket initialisé, avec retry propre.
2. **Navigateur non reconnu** → WhatsApp rejette les nouveaux appairages identifiés comme `WEB`.
   ✅ Ajout de `browser: Browsers.macOS('Safari')`, étiquette canonique acceptée.
3. **Baileys trop ancien** (`@whiskeysockets/baileys` 6.7.9) → protocole d'appairage obsolète.
   ✅ Migration vers le paquet `baileys` 6.7.23.
4. **Erreur stream 515** juste après l'appairage non gérée → la session ne se finalisait jamais.
   ✅ Le code 515 (`restartRequired`) déclenche une reconnexion immédiate.
5. **Sessions perdues à chaque redémarrage** (système de fichiers éphémère).
   ✅ Les sessions sont stockées dans `DATA_DIR` et restaurées automatiquement au démarrage.

---

## Lancer en local

```bash
npm install
cp .env.example .env   # (optionnel) ajuste les variables
npm start
```

Ouvre ensuite http://localhost:3000, entre ton numéro **au format international** (ex : `224661817807`, sans `+`, sans espaces), et entre le code affiché dans :
**WhatsApp → Réglages → Appareils connectés → Connecter un appareil → Connecter avec numéro de téléphone.**

---

## Déploiement sur Render

1. Pousse ce dossier sur GitHub.
2. Sur Render : **New → Blueprint**, sélectionne le repo (il lira `render.yaml`).
3. Important : le `render.yaml` utilise le plan **starter** (payant) car le **disque persistant** (`/data`) est nécessaire pour garder les sessions entre les redéploiements. En plan *free*, le bot fonctionne mais tu devras ré-appairer après chaque redémarrage, et Render endort le service après 15 min d'inactivité.
4. Pour éviter la mise en veille : crée un **cron** (ex. [cron-job.org](https://cron-job.org)) qui appelle `https://ton-app.onrender.com/health` toutes les 10 minutes.

---

## Déploiement sur Katabump (recommandé pour un bot 24/7)

Katabump fournit un hébergement de type "serveur" qui ne s'endort pas, idéal pour Baileys.

1. Crée un serveur **Node.js** sur le panel Katabump.
2. Upload le projet (ou clone depuis GitHub).
3. Commande d'install : `npm install` — commande de démarrage : `node index.js`.
4. Dans les variables d'environnement, mets `DATA_DIR` vers un dossier persistant du serveur (ex : `/home/container/data`), pour ne pas perdre les sessions.
5. Ouvre le port web exposé par Katabump pour accéder à la page de connexion.

---

## Endpoints

| Méthode | URL | Rôle |
|--------|-----|------|
| GET | `/` | Page web multi-connexion |
| GET | `/health` | Health check / keep-alive |
| GET | `/status` | État JSON des sessions |
| POST | `/add-session` | Ajouter un numéro (`{ "phone": "224..." }`) |
| POST | `/remove-session` | Supprimer une session (`{ "id": 1 }`) |

---

## ⚠️ Avertissement

Baileys est un client **non officiel**. Utilise un **numéro secondaire** : WhatsApp peut bannir les numéros utilisés par des bots. À utiliser uniquement pour du contenu légal et éthique.
