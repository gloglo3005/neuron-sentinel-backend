import { prisma } from '../config/db.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { zoneLookupService } from '../services/zoneLookupService.js';
import { zoneSummaryDto, alertSummaryDto, reportSummaryDto } from '../dto/citizenDto.js';
import { emit } from '../realtime/io.js';

// POST /api/citizen/location  { latitude, longitude }
// Resolves the zone via PostGIS-equivalent lookup (see zoneLookupService)
// and persists it on the citizen's account (spec section 6) so subsequent
// requests (GET /zone/current, GET /alerts) don't need GPS every time —
// spec section 16: don't ask for geolocation continuously.
export const updateLocation = asyncHandler(async (req, res) => {
  const { latitude, longitude } = req.body;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new HttpError(400, 'latitude et longitude (nombres) sont requis.');
  }

  const zone = await zoneLookupService.findZoneForPoint(latitude, longitude);
  if (!zone) throw new HttpError(503, 'Aucune zone configurée pour le moment.');

  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      assignedZoneId: zone.id,
      lastLatitude: latitude,
      lastLongitude: longitude,
      locationUpdatedAt: new Date(),
    },
  });

  res.json({ zoneId: zone.id, zoneName: zone.name });
});

// Shared by GET /zone/current and GET /alerts — a citizen with no
// resolved zone yet must send their location first.
async function requireCitizenZone(req) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user.assignedZoneId) {
    throw new HttpError(409, "Localisation non définie — envoyez d'abord votre position via POST /api/citizen/location.");
  }
  return prisma.zone.findUnique({ where: { id: user.assignedZoneId } });
}

// GET /api/citizen/zone/current
// The PWA home screen (spec section 7): zone, weather, risk, active alert
// — one call, everything the citizen needs, nothing they don't (no raw AI
// factors, no admin fields).
export const getCurrentZone = asyncHandler(async (req, res) => {
  const zone = await requireCitizenZone(req);
  if (!zone) throw new HttpError(404, 'Zone introuvable.');

  const [environmental, prediction, alert] = await Promise.all([
    prisma.environmentalData.findFirst({ where: { zoneId: zone.id }, orderBy: { timestamp: 'desc' } }),
    prisma.prediction.findFirst({ where: { zoneId: zone.id }, orderBy: { generatedAt: 'desc' } }),
    prisma.alert.findFirst({
      where: { status: { in: ['DISPATCHED', 'ACTIVE'] }, zones: { some: { zoneId: zone.id } } },
      include: { zones: { include: { zone: { select: { name: true } } } } },
      orderBy: { dispatchedAt: 'desc' },
    }),
  ]);

  res.json(zoneSummaryDto(zone, { environmental, prediction, alert }));
});

// GET /api/citizen/alerts
// Alert history for the citizen's zone — not just the single active one
// shown on the home screen (spec section 8). Only ever alerts that have
// actually been dispatched to citizens; PROPOSED/UNDER_REVIEW/CONFIRMED
// alerts are internal dashboard workflow states a citizen has no reason
// to see before an authority has actually released them.
export const listAlertsForCitizen = asyncHandler(async (req, res) => {
  const zone = await requireCitizenZone(req);
  if (!zone) throw new HttpError(404, 'Zone introuvable.');

  const alerts = await prisma.alert.findMany({
    where: {
      status: { in: ['DISPATCHED', 'ACTIVE', 'RESOLVED'] },
      zones: { some: { zoneId: zone.id } },
    },
    include: { zones: { include: { zone: { select: { name: true } } } } },
    orderBy: { dispatchedAt: 'desc' },
    take: 20,
  });

  res.json(alerts.map(alertSummaryDto));
});

// POST /api/citizen/reports  { type, description, latitude, longitude, media }
// Reuses IncidentReport as-is (spec section 10) — this is exactly the
// entry point the backend already anticipated (see the comment that used
// to be on incidentsController.createIncident: "future entry point for the
// citizen app"). Now that citizen auth exists, reportedById is finally set.
export const createReport = asyncHandler(async (req, res) => {
  const { type, description, latitude, longitude, media } = req.body;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !type) {
    throw new HttpError(400, 'type, latitude et longitude sont requis.');
  }

  // Best-effort zone tagging so it shows up correctly filtered on the
  // dashboard's map — doesn't block the report if lookup fails.
  const zone = await zoneLookupService.findZoneForPoint(latitude, longitude).catch(() => null);

  const report = await prisma.incidentReport.create({
    data: {
      type,
      description,
      latitude,
      longitude,
      zoneId: zone?.id ?? null,
      reportedById: req.user.id,
      status: 'PENDING',
      media: media?.length
        ? { create: media.map((m) => ({ type: m.type, url: m.url, verificationStatus: 'UNKNOWN' })) }
        : undefined,
    },
    include: { media: true },
  });

  // Reuses the exact same realtime event the dashboard already listens to
  // (see incidentsController.createIncident) — no new socket wiring needed
  // for the report to show up live on the authorities' side.
  emit('incident.created', report);

  res.status(201).json(reportSummaryDto(report));
});

// GET /api/citizen/reports/mine
export const listMyReports = asyncHandler(async (req, res) => {
  const reports = await prisma.incidentReport.findMany({
    where: { reportedById: req.user.id },
    include: { media: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(reports.map(reportSummaryDto));
});
