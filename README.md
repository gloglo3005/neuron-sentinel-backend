# Neuron Sentinel — Backend

Backend API du projet **Neuron Sentinel**, un système intelligent de prédiction et d'alerte précoce des risques d'inondation pour les zones urbaines.

## 🎯 Rôle du backend

Le backend sert d'intermédiaire entre les différentes interfaces de Neuron Sentinel et les données du système.

Il gère notamment :

* l'authentification des citoyens et des autorités ;
* la gestion des utilisateurs ;
* la réception et la consultation des données ;
* la gestion des zones à risque ;
* les alertes d'inondation ;
* la communication avec la base de données PostgreSQL ;
* les fonctionnalités nécessaires à l'intégration future des modèles d'intelligence artificielle.

## 🛠️ Technologies

* Node.js
* Express.js
* TypeScript / JavaScript
* Prisma ORM
* PostgreSQL
* PostGIS
* JWT
* REST API

## 📁 Structure

```text
backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── controllers/
│   ├── routes/
│   ├── middleware/
│   └── ...
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 🚀 Installation

Cloner le repository :

```bash
git clone https://github.com/USERNAME/neuron-sentinel-backend.git
cd neuron-sentinel-backend
```

Installer les dépendances :

```bash
npm install
```

Créer le fichier `.env` à partir de `.env.example` et renseigner les variables nécessaires.

## 🗄️ Base de données

Le projet utilise PostgreSQL avec Prisma.

Après avoir configuré `DATABASE_URL` :

```bash
npx prisma generate
```

Puis appliquer les migrations :

```bash
npx prisma migrate dev
```

## ▶️ Lancer le serveur

En développement :

```bash
npm run dev
```

Le serveur sera disponible sur :

```text
http://localhost:4000
```

## 🔌 API

Les principales routes sont organisées sous :

```text
/api/citizen
/api/auth
/api/alerts
/api/zones
```

Les routes peuvent évoluer selon les besoins du projet.

## 🔐 Variables d'environnement

Les informations sensibles ne sont pas stockées dans Git.

Exemple :

```env
DATABASE_URL=
JWT_SECRET=
PORT=4000
```

Voir `.env.example` pour la liste des variables nécessaires.

## 🌍 Déploiement

Le backend est prévu pour être déployé sur **Render**.

Le frontend Dashboard et le PWA sont déployés séparément et communiquent avec cette API.

## 👥 Projet

**Neuron Sentinel**

AI-Powered Flood Prediction and Early Warning System for Smart Cities.

Projet développé dans le cadre d'un hackathon.
