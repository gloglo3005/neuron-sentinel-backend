#!/usr/bin/env node
// Usage:
//   cd backend
//   node scripts/geocodeZones.js "Hédzranawoé" "Nyékonakpoè" "Akodesséwa" ...
//
// One-shot CLI helper — turns a list of quartier names into ready-to-paste
// entries for prisma/seed.js's ZONES array, using real coordinates from
// OpenStreetMap/Nominatim (the exact same free geocoder already used in
// production by src/services/geoService.js for the polygon sync, see
// POST /api/zones/sync-geometry). This script exists so nobody ever has
// to eyeball a new quartier's GPS position by hand on a flood-alert app
// where a wrong coordinate means a citizen gets assigned to the wrong
// zone — geocode it for real instead.
//
// Workflow:
//   1. node scripts/geocodeZones.js "Quartier 1" "Quartier 2" ...
//   2. Paste the printed lines into ZONES in prisma/seed.js
//   3. Fill in the four fields no geocoder can know — pop / drain / hist /
//      rain — these need actual local knowledge (population estimate,
//      drainage quality, flood history), not GPS data. They're left as
//      TODO placeholders on purpose rather than guessed.
//   4. npx prisma db seed  (safe to re-run — seed.js upserts zones by name)
//   5. Log in to the dashboard and click "Sync géométrie" on the Risk Map
//      page (POST /api/zones/sync-geometry) once, so every zone — old and
//      newly added — gets its real OpenStreetMap polygon boundary instead
//      of just this script's centroid+radius circle. That's the step that
//      actually turns geolocation from "circle guess" into "real contour".
//
// Respects Nominatim's usage policy (same as geoService.js): descriptive
// User-Agent, ~1 request/second, sequential (no parallel calls).

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'NeuronSentinel/1.0 (projet etudiant - early-warning inondations Lome)';const EARTH_RADIUS_M = 6371000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Simple, readable 3-letter code from the name — matches the ZONES.code
// convention already used in seed.js (BE, KDV, AMT...). Not guaranteed
// unique for every possible quartier name; check for collisions with the
// existing ZONES array before pasting if you're adding many at once.
function codeFrom(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents (é, è...)
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 3);
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocode(name) {
  const q = `${name}, Lomé, Togo`;
  const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(q)}&format=jsonv2&limit=1`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch (err) {
    throw new Error(`OpenStreetMap injoignable (${err.message})`);
  }
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const [match] = await res.json();
  if (!match) throw new Error("Aucun résultat — vérifier l'orthographe du quartier");

  const lat = parseFloat(match.lat);
  const lng = parseFloat(match.lon);
  // boundingbox = [south, north, west, east] (strings) — used to derive a
  // sensible circle radius covering the same area this centroid sits in,
  // for the immediate fallback circle (before "Sync géométrie" replaces
  // it with the real polygon).
  const [south, north, west, east] = match.boundingbox.map(Number);
  const cornerDistances = [
    haversineMeters(lat, lng, north, east),
    haversineMeters(lat, lng, north, west),
    haversineMeters(lat, lng, south, east),
    haversineMeters(lat, lng, south, west),
  ];
  // Clamped to stay in the same range as the existing hand-picked radii in
  // seed.js (700–1300m) — Nominatim's bounding box is sometimes far wider
  // than the actual neighbourhood (e.g. it matched a whole canton), so an
  // unclamped radius could swallow a neighbouring zone's citizens.
  const radius = Math.max(400, Math.min(1500, Math.round(Math.max(...cornerDistances))));

  return {
    lat: Math.round(lat * 10000) / 10000,
    lng: Math.round(lng * 10000) / 10000,
    radius,
  };
}

async function main() {
  const names = process.argv.slice(2);
  if (!names.length) {
    console.error('Usage: node scripts/geocodeZones.js "Quartier 1" "Quartier 2" ...');
    process.exit(1);
  }

  console.log('// Coller ci-dessous dans ZONES (prisma/seed.js).');
  console.log('// Compléter pop / drain / hist / rain à la main — aucun géocodeur ne connaît');
  console.log("// la population, le drainage ou l'historique d'inondation d'un quartier.\n");

  for (const name of names) {
    try {
      const { lat, lng, radius } = await geocode(name);
      console.log(
        `  { name: '${name}', code: '${codeFrom(name)}', lat: ${lat}, lng: ${lng}, ` +
        `pop: /* TODO */ 0, drain: /* TODO 0-100 */ 50, hist: /* TODO 0-100 */ 20, rain: /* TODO 0-100 */ 30, radius: ${radius} },`
      );
    } catch (err) {
      console.error(`  // ÉCHEC "${name}": ${err.message}`);
    }
    await sleep(1100); // Nominatim usage policy: max ~1 req/s, stay sequential
  }
}

main();