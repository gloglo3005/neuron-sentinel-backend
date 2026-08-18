import http from 'http';
import { app } from './app.js';
import { env } from './config/env.js';
import { initSocket } from './realtime/io.js';
import { prisma } from './config/db.js';
import { weatherService } from './services/weatherService.js';
import { runWeatherSync } from './controllers/environmentalController.js';

const server = http.createServer(app);
initSocket(server);

server.listen(env.port, () => {
  console.log(`Neuron Sentinel backend en écoute sur http://localhost:${env.port}`);
  console.log(`Mode: ${env.nodeEnv}`);
});

// Only runs against the real WeatherProvider — in MOCK mode there's no
// point ingesting synthetic rows on a timer (spec section 33: never
// silently present fabricated data as if it were a live feed). Trigger
// POST /api/environmental-data/sync manually instead while in MOCK mode.
let weatherSyncTimer = null;
if (!weatherService.isMock) {
  const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 min — free-tier OpenWeatherMap friendly
  const tick = () =>
    runWeatherSync()
      .then((r) => console.log(`[weather-sync] ${r.synced}/${r.total} zones synchronisées`, r.errors.length ? r.errors : ''))
      .catch((err) => console.error('[weather-sync] échec', err.message));
  tick(); // one immediate sync on boot so the dashboard isn't empty
  weatherSyncTimer = setInterval(tick, SYNC_INTERVAL_MS);
}

// Les hébergeurs Postgres "free tier" (Neon, Supabase, etc.) ferment les
// connexions inactives au bout de quelques minutes. Sans trafic sur l'API
// pendant ce délai, Prisma se retrouve avec une connexion morte et log
// "Error in PostgreSQL connection: Error { kind: Closed, cause: None }" au
// prochain accès (la requête suivante réussit quand même — Prisma
// rouvre une connexion — mais ce bruit peut masquer de vraies erreurs, et
// la 1ère requête après une coupure repart avec une latence de reconnexion
// en pleine démo). Un ping léger et régulier maintient la connexion active.
const DB_KEEPALIVE_MS = 4 * 60 * 1000; // 4 min < le délai d'inactivité observé (~5 min)
const dbKeepAliveTimer = setInterval(() => {
  prisma.$queryRaw`SELECT 1`.catch((err) =>
    console.error('[db-keepalive] échec du ping Postgres', err.message),
  );
}, DB_KEEPALIVE_MS);

async function shutdown() {
  console.log('Arrêt en cours...');
  if (weatherSyncTimer) clearInterval(weatherSyncTimer);
  clearInterval(dbKeepAliveTimer);
  await prisma.$disconnect();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);