# Neuron Sentinel — Backend

API Express + Prisma + PostgreSQL pour le dashboard des autorités.

## Accès réservé aux autorités

**Seuls les rôles `CIVIL_PROTECTION` (ANPC), `AUTHORITY` (Mairie) et
`EMERGENCY_SERVICE` (Pompiers/GNSP) peuvent se connecter à cette API.**
`ADMIN` et `CITIZEN` existent dans le modèle de données (affectation de
zones, futurs signalements citoyens) mais sont explicitement rejetés par
`POST /api/auth/login`, quel que soit le mot de passe — ils sont destinés à
d'autres interfaces non développées dans cette passe.

Détail des mesures de durcissement dans `src/middleware/auth.js`,
`src/controllers/authController.js` et `src/utils/permissions.js` :
verrouillage de compte après 5 échecs (15 min), rate-limit dédié sur
`/auth/login`, aucune route d'auto-inscription, vérification de permission
côté serveur sur chaque action (jamais seulement côté frontend), journal
d'audit de chaque tentative de connexion avec IP.

## Démarrage

```bash
cp .env.example .env      # puis renseigner DATABASE_URL et JWT_SECRET
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev                # http://localhost:4000
```

Comptes de démonstration créés par `npm run seed` (mot de passe unique
`NeuronDemo#2026`, **local uniquement, à changer avant tout déploiement**) :

| Rôle | Téléphone |
|---|---|
| ANPC (CIVIL_PROTECTION) | +22890000001 |
| Mairie (AUTHORITY) | +22890000002 |
| GNSP (EMERGENCY_SERVICE) | +22890000003 |
| Observateur (lecture seule) | +22890000004 |

## Note sur ce sandbox de développement

`npx prisma generate` / `migrate` ne fonctionnent pas dans le sandbox où ce
code a été écrit : le réseau y est restreint à une liste blanche de domaines
qui n'inclut pas `binaries.prisma.sh` (le CDN des moteurs Prisma), donc le
téléchargement échoue avec une 403. Ce n'est pas un problème du code — sur
votre machine ou en CI avec un accès réseau normal,
`npm install && npx prisma migrate dev` fonctionnera normalement. Dans ce
même sandbox, une instance PostgreSQL locale a néanmoins pu être installée
et démarrée pour vérifier que le schéma est valide, et le serveur Express a
été testé (routing, RBAC, ordre des middlewares) avec un client Prisma
stubbé.

## Fournisseurs externes (MOCK par défaut)

`weatherService`, `satelliteService`, `smsService`, `aiService` dans
`src/services/` tournent tous en mode MOCK tant que la variable d'env
correspondante (`WEATHER_API_KEY`, `SATELLITE_API_KEY`, `SMS_API_KEY`,
`AI_API_KEY`) est vide — jamais présenté comme une vraie donnée côté
frontend (voir `source: 'MOCK'` dans chaque réponse).
