import { prisma } from '../config/db.js';

// GET /api/dashboard/summary
// Backs Dashboard.jsx's KPI cards. Everything here is a live aggregate —
// nothing is hard-coded, per spec section 5.
export async function getDashboardSummary(req, res) {
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
}
