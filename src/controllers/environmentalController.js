import { prisma } from '../config/db.js';
import { weatherService } from '../services/weatherService.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// GET /api/environmental-data?zoneId=&from=&to=&limit=
// Always returns the history, never just the latest reading (spec section
// 18 — "ne pas conserver uniquement la dernière mesure").
// Wrapped in asyncHandler — see dashboardController.js for why this
// matters (unhandled rejection = whole process crashes on Node 15+).
export const listEnvironmentalData = asyncHandler(async (req, res) => {
  const { zoneId, from, to } = req.query;
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const where = {};
  if (zoneId) where.zoneId = zoneId;
  if (from || to) {
    where.timestamp = {};
    if (from) where.timestamp.gte = new Date(from);
    if (to) where.timestamp.lte = new Date(to);
  }

  const rows = await prisma.environmentalData.findMany({
    where,
    orderBy: { timestamp: 'asc' },
    take: limit,
    include: { zone: { select: { name: true } } },
  });
  res.json(rows);
});

// Pulls one current-weather reading per zone from the configured
// WeatherProvider (real OpenWeatherMap if WEATHER_API_KEY is set, MOCK
// otherwise — see src/services/weatherService.js) and persists it. Shared
// by the manual POST /sync endpoint below and the periodic interval in
// src/server.js.
export async function runWeatherSync() {
  const zones = await prisma.zone.findMany();
  const results = await Promise.allSettled(
    zones.map(async (zone) => {
      const reading = await weatherService.getCurrentWeather(zone);
      return prisma.environmentalData.create({
        data: {
          zoneId: zone.id,
          source: reading.source,
          timestamp: reading.timestamp,
          rainfall: reading.rainfall,
          temperature: reading.temperature,
          humidity: reading.humidity,
          windSpeed: reading.windSpeed,
          rawData: reading.rawData,
        },
      });
    })
  );
  const created = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected');
  return { synced: created, total: zones.length, mock: weatherService.isMock, errors: failed.map((f) => f.reason?.message || 'Erreur inconnue') };
}

// POST /api/environmental-data/sync — manual trigger (e.g. a "Sync now"
// button before a demo), reusing the same logic as the interval.
export const syncEnvironmentalData = asyncHandler(async (req, res) => {
  res.json(await runWeatherSync());
});