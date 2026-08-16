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

// Marks each alert with whether the current citizen has already
// acknowledged it (NotificationAcknowledgement — modeled in schema.prisma
// but never actually wired up until now, see acknowledgeAlert below).
// Mutates the alert objects in place so callers can just pass them
// straight into alertSummaryDto/zoneSummaryDto afterwards.
async function attachAcknowledged(userId, alerts) {
  const list = alerts.filter(Boolean);
  if (!list.length) return alerts;
  const acks = await prisma.notificationAcknowledgement.findMany({
    where: { userId, notification: { alertId: { in: list.map((a) => a.id) } } },
    select: { notification: { select: { alertId: true } } },
  });
  const ackedIds = new Set(acks.map((a) => a.notification.alertId));
  for (const a of list) a.acknowledged = ackedIds.has(a.id);
  return alerts;
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
  if (alert) await attachAcknowledged(req.user.id, [alert]);

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
  await attachAcknowledged(req.user.id, alerts);

  res.json(alerts.map(alertSummaryDto));
});

// POST /api/citizen/alerts/:alertId/acknowledge
// Closes the loop on NotificationAcknowledgement, which existed in the
// schema (and was listed as an existing feature in spec section 5) but
// had no route/controller anywhere — "accusé de réception" was a table,
// not a feature. An alert is broadcast (Notification.recipient ===
// 'BROADCAST', see alertsController.dispatchAlert) rather than fanned out
// per citizen, so there's one Notification row per channel (SMS, PUSH…)
// for the whole alert; acknowledging the alert acknowledges all of them
// for this citizen, which is what the PWA actually needs to show ("vu").
export const acknowledgeAlert = asyncHandler(async (req, res) => {
  const zone = await requireCitizenZone(req);
  if (!zone) throw new HttpError(404, 'Zone introuvable.');

  const alert = await prisma.alert.findFirst({
    where: { id: req.params.alertId, zones: { some: { zoneId: zone.id } } },
    include: { notifications: true },
  });
  if (!alert) throw new HttpError(404, "Alerte introuvable pour votre zone.");
  if (!['DISPATCHED', 'ACTIVE', 'RESOLVED'].includes(alert.status)) {
    throw new HttpError(409, "Cette alerte n'a pas encore été diffusée — rien à confirmer pour le moment.");
  }
  if (!alert.notifications.length) {
    // Defensive only — dispatchAlert always creates Notification rows
    // before an alert can reach DISPATCHED, so this shouldn't happen.
    throw new HttpError(409, 'Aucune notification associée à cette alerte.');
  }

  // No @@unique([notificationId, userId]) on NotificationAcknowledgement
  // in schema.prisma, so this does a manual check-then-create instead of
  // an upsert. A double-tap race is possible in theory but harmless here
  // (duplicate ack rows, not a correctness issue for a "seen" flag) —
  // not worth a schema migration for (spec section 32: don't touch Prisma
  // unless truly necessary).
  for (const notification of alert.notifications) {
    const existing = await prisma.notificationAcknowledgement.findFirst({
      where: { notificationId: notification.id, userId: req.user.id },
    });
    if (!existing) {
      await prisma.notificationAcknowledgement.create({
        data: { notificationId: notification.id, userId: req.user.id, status: 'ACKNOWLEDGED' },
      });
    }
  }

  res.json({ success: true, acknowledgedAt: new Date().toISOString() });
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