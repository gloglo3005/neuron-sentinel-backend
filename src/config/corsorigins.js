import { env } from './env.js';

// CORS is locked to a known set of origins — this API is not a public API.
// env.corsOrigin holds the fixed origins (localhost dev ports + the main
// production Vercel URL). On top of that we also accept any Vercel
// *preview* deployment URL for this project (e.g.
// https://neuron-sentinel-83oqbmgj0-glorie.vercel.app or
// https://neuron-sentinel-dashboard-3swvfuz8r-glorie.vercel.app), since
// Vercel mints a new one on every preview build across every Vercel
// project we have (pwa, dashboard, ...) and we don't want to hand-edit
// CORS_ORIGIN each time. Matches any subdomain starting with
// "neuron-sentinel-" and ending in "-glorie.vercel.app". Adjust if the
// Vercel account/team slug ("glorie") ever changes.
const VERCEL_PREVIEW_REGEX = /^https:\/\/neuron-sentinel-[a-z0-9-]+-glorie\.vercel\.app$/;

// Shared by app.js (REST CORS) and realtime/io.js (Socket.io CORS) so the
// two never drift apart again — previously io.js used env.corsOrigin
// directly and silently ignored preview URLs that app.js allowed.
export function isAllowedOrigin(origin) {
  if (!origin) return true; // non-browser requests (curl, server-to-server, health checks)
  if (env.corsOrigin.includes(origin)) return true;
  return VERCEL_PREVIEW_REGEX.test(origin);
}