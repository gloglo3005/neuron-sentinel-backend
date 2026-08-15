import { prisma } from '../config/db.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { emit } from '../realtime/io.js';

// GET /api/incidents?status=&zoneId=
export const listIncidents = asyncHandler(async (req, res) => {
  const { status, zoneId } = req.query;
  const where = {};
  if (status) where.status = status;
  if (zoneId) where.zoneId = zoneId;

  const incidents = await prisma.incidentReport.findMany({
    where,
    include: { media: true, zone: { select: { name: true } }, reportedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(incidents);
});

// POST /api/incidents
// Not exposed to citizens yet (no citizen auth in this pass — spec section
// 16) but the shape matches what the future mobile app will send:
// GPS + type + description + optional media. reportedById stays null for
// now; it will be populated once phone+OTP auth exists.
export const createIncident = asyncHandler(async (req, res) => {
  const { type, description, latitude, longitude, zoneId, media } = req.body;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !type) {
    throw new HttpError(400, 'type, latitude et longitude sont requis.');
  }
  const incident = await prisma.incidentReport.create({
    data: {
      type, description, latitude, longitude, zoneId: zoneId || null,
      status: 'PENDING',
      media: media?.length
        ? { create: media.map((m) => ({ type: m.type, url: m.url, verificationStatus: 'UNKNOWN' })) }
        : undefined,
    },
    include: { media: true },
  });
  emit('incident.created', incident);
  res.status(201).json(incident);
});

// POST /api/incidents/:id/verify { decision: 'CONFIRMED'|'REJECTED'|'VERIFYING' }
// A report is never assumed true by default (spec section 17) — an
// authority must explicitly confirm, reject, or request further checking.
export const verifyIncident = asyncHandler(async (req, res) => {
  const { decision } = req.body;
  if (!['CONFIRMED', 'REJECTED', 'VERIFYING'].includes(decision)) {
    throw new HttpError(400, 'decision doit être CONFIRMED, REJECTED ou VERIFYING.');
  }
  const incident = await prisma.incidentReport.update({
    where: { id: req.params.id },
    data: { status: decision, verifiedAt: new Date(), verifiedById: req.user.id },
  });
  res.json(incident);
});
