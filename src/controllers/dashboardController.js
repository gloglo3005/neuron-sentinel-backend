import { prisma } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// GET /api/dashboard/summary
// Backs Dashboard.jsx's KPI cards. Everything here is a live aggregate —
// nothing is hard-coded, per spec section 5.
//
// Wrapped in asyncHandler (was previously a bare async function): without
// it, a rejected promise here (e.g. a dropped DB connection) becomes an
// unhandled promise rejection instead of reaching errorHandler — and since
// Node 15+, an unhandled rejection terminates the whole process by
// default, taking down the backend for every connected client, not just
// this one request.
export const getDashboardSummary = asyncHandler(async (req, res) => {
  const [zones, openAlerts, recentPredictions] = await Promise.all([
    prisma.zone.findMany({ select: { riskLevel: true, population: true } }),
    prisma.alert.findMany({
      where: { status: { in: ['PROPOSED', 'UNDER_REVIEW', 'CONFIRMED', 'DISPATCHED', 'ACTIVE'] } },
      include: { zones: { include: { zone: { select: { population: true } } } } },
    }),
    prisma.prediction.findMany({ orderBy: { generatedAt: 'desc' }, take: 50, select: { confidence: true, generatedAt: true } }),
  ]);

  const criticalZones = zones.filter((z) => z.riskLevel === 'CRITICAL').length;
  const highRiskZones = zones.filter((z) => z.riskLevel === 'HIGH' || z.riskLevel === 'CRITICAL').length;
  const alertsToTreat = openAlerts.filter((a) => a.status === 'PROPOSED' || a.status === 'UNDER_REVIEW').length;

  const exposedZoneIds = new Set();
  let populationExposed = 0;
  for (const alert of openAlerts) {
    for (const az of alert.zones) {
      // Avoid double-counting a zone covered by two simultaneous alerts.
      if (!exposedZoneIds.has(az.zoneId)) {
        exposedZoneIds.add(az.zoneId);
        populationExposed += az.zone.population;
      }
    }
  }

  const avgConfidence = recentPredictions.length
    ? Math.round(recentPredictions.reduce((s, p) => s + p.confidence, 0) / recentPredictions.length)
    : null;
  const lastUpdate = recentPredictions[0]?.generatedAt ?? null;

  res.json({
    criticalZones,
    highRiskZones,
    alertsToTreat,
    populationExposed,
    avgModelConfidence: avgConfidence,
    lastUpdate,
  });
});