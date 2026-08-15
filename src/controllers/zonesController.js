import { prisma } from '../config/db.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { geoService } from '../services/geoService.js';

const HORIZONS = [0, 6, 12, 24, 48]; // hours — matches frontend horizons ["Maintenant","+6h","+12h","+24h","+48h"]

// Builds the 5-point riskSeries the frontend expects: the most recent
// prediction.probability for each horizon bucket, falling back to the
// zone's static rainScore-derived baseline if no prediction exists yet for
// that horizon (e.g. right after seeding, before the AI job has run).
async function riskSeriesFor(zone) {
  const predictions = await prisma.prediction.findMany({
    where: { zoneId: zone.id, horizon: { in: HORIZONS } },
    orderBy: { generatedAt: 'desc' },
  });
  return HORIZONS.map((h) => {
    const p = predictions.find((pr) => pr.horizon === h);
    return p ? Math.round(p.probability) : Math.round(zone.rainScore * 0.6);
  });
}

// GET /api/zones
export const listZones = asyncHandler(async (req, res) => {
  const zones = await prisma.zone.findMany({ orderBy: { name: 'asc' } });
  const rows = await Promise.all(
    zones.map(async (z) => ({
      id: z.id,
      name: z.name,
      lat: z.latitude,
      lng: z.longitude,
      population: z.population,
      drainScore: z.drainScore,
      historyScore: z.historyScore,
      rainScore: z.rainScore,
      riskSeries: await riskSeriesFor(z),
      radius: z.radius,
      // Real OpenStreetMap polygon (GeoJSON Feature) once synced via
      // POST /zones/sync-geometry — null until then, in which case the
      // frontend falls back to drawing the mock circle (z.radius).
      geometry: z.geometry,
    }))
  );
  res.json(rows);
});

// GET /api/zones/:id
export const getZone = asyncHandler(async (req, res) => {
  const zone = await prisma.zone.findUnique({ where: { id: req.params.id } });
  if (!zone) throw new HttpError(404, 'Zone introuvable.');
  res.json({
    id: zone.id, name: zone.name, code: zone.code, lat: zone.latitude, lng: zone.longitude,
    population: zone.population, riskLevel: zone.riskLevel, drainScore: zone.drainScore,
    historyScore: zone.historyScore, rainScore: zone.rainScore, radius: zone.radius,
    geometry: zone.geometry,
    riskSeries: await riskSeriesFor(zone),
  });
});

// GET /api/zones/:id/predictions
export const getZonePredictions = asyncHandler(async (req, res) => {
  const zone = await prisma.zone.findUnique({ where: { id: req.params.id } });
  if (!zone) throw new HttpError(404, 'Zone introuvable.');
  const predictions = await prisma.prediction.findMany({
    where: { zoneId: zone.id },
    include: { factors: true, outcome: true },
    orderBy: { generatedAt: 'desc' },
    take: 20,
  });
  res.json(predictions);
});

// POST /api/zones/sync-geometry
// One-shot job (not on a timer like the weather sync — real neighbourhood
// boundaries don't move): looks up each zone's real polygon on
// OpenStreetMap and persists it to Zone.geometry, replacing the mock
// circle placeholder. Safe to re-run — it just overwrites with the same
// (or updated) boundary. Sequential + ~1s between requests, so this takes
// roughly (number of zones) seconds — respond only once fully done.
export const syncZoneGeometry = asyncHandler(async (req, res) => {
  const zones = await prisma.zone.findMany({ select: { id: true, name: true } });
  const results = await geoService.getBoundaries(zones);

  let updated = 0;
  for (const r of results) {
    if (!r.geometry) continue;
    await prisma.zone.update({ where: { id: r.id }, data: { geometry: r.geometry } });
    updated += 1;
  }

  res.json({
    updated,
    total: zones.length,
    errors: results.filter((r) => r.error).map((r) => {
      const zone = zones.find((z) => z.id === r.id);
      return `${zone?.name || r.id}: ${r.error}`;
    }),
  });
});