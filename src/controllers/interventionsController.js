import { prisma } from '../config/db.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { emit } from '../realtime/io.js';

const include = { zone: { select: { name: true } }, teams: { include: { team: true } } };

// GET /api/interventions?zoneId=&status=
export const listInterventions = asyncHandler(async (req, res) => {
  const { zoneId, status } = req.query;
  const where = {};
  if (zoneId) where.zoneId = zoneId;
  if (status) where.status = status;
  const interventions = await prisma.intervention.findMany({ where, include, orderBy: { startedAt: 'desc' } });
  res.json(interventions);
});

// POST /api/interventions { alertId?, zoneId, mission, teamIds: [] }
export const createIntervention = asyncHandler(async (req, res) => {
  const { alertId, zoneId, mission, teamIds = [] } = req.body;
  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!zone) throw new HttpError(404, 'Zone introuvable.');

  const intervention = await prisma.intervention.create({
    data: {
      alertId: alertId || null,
      zoneId,
      mission,
      status: 'PLANNED',
      teams: { create: teamIds.map((teamId) => ({ teamId, status: 'DISPATCHED' })) },
    },
    include,
  });
  // Matches the event list already documented in src/realtime/io.js
  // ("Events emitted so far: ... intervention.updated") — creation and
  // status changes are both "intervention.updated" from a client's point
  // of view (there's no separate "intervention.created" listener anywhere
  // in the frontend, so one event name keeps this simple, per spec section
  // 14: don't add complexity that isn't needed).
  emit('intervention.updated', intervention);
  res.status(201).json(intervention);
});

// POST /api/interventions/:id/status { status, result? }
export const updateInterventionStatus = asyncHandler(async (req, res) => {
  const { status, result } = req.body;
  const data = { status };
  if (status === 'IN_PROGRESS') data.startedAt = new Date();
  if (status === 'COMPLETED') { data.completedAt = new Date(); data.result = result; }
  const intervention = await prisma.intervention.update({ where: { id: req.params.id }, data, include });
  emit('intervention.updated', intervention);
  res.json(intervention);
});