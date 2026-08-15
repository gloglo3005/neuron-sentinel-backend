import { prisma } from '../config/db.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { smsService } from '../services/smsService.js';
import { emit } from '../realtime/io.js';

const include = {
  zones: { include: { zone: { select: { id: true, name: true } } } },
  events: { orderBy: { timestamp: 'asc' }, include: { user: { select: { name: true, role: true } } } },
  notifications: true,
  createdBy: { select: { name: true, role: true } },
  validatedBy: { select: { name: true, role: true } },
};

function serialize(alert) {
  return {
    id: alert.id,
    title: alert.title,
    description: alert.description,
    type: alert.type,
    severity: alert.severity,
    status: alert.status,
    source: alert.source,
    predictionId: alert.predictionId,
    zones: alert.zones.map((z) => z.zone),
    proposer: alert.createdBy?.name,
    proposerRole: alert.createdBy?.role,
    validatedBy: alert.validatedBy?.name ?? null,
    rejectionReason: alert.rejectionReason,
    createdAt: alert.createdAt,
    dispatchedAt: alert.dispatchedAt,
    resolvedAt: alert.resolvedAt,
    closedAt: alert.closedAt,
    events: alert.events.map((e) => ({ label: e.details ?? e.action, actor: e.user?.name ?? 'Système', role: e.user?.role ?? 'SYSTEM', time: e.timestamp })),
    notifications: alert.notifications,
  };
}

async function addEvent(alertId, userId, action, details) {
  return prisma.alertEvent.create({ data: { alertId, userId, action, details } });
}

// GET /api/alerts?status=&zoneId=&severity=
export const listAlerts = asyncHandler(async (req, res) => {
  const { status, zoneId, severity } = req.query;
  const where = {};
  if (status) where.status = status;
  if (severity) where.severity = severity;
  if (zoneId) where.zones = { some: { zoneId } };

  const alerts = await prisma.alert.findMany({ where, include, orderBy: { createdAt: 'desc' } });
  res.json(alerts.map(serialize));
});

// GET /api/alerts/:id
export const getAlert = asyncHandler(async (req, res) => {
  const alert = await prisma.alert.findUnique({ where: { id: req.params.id }, include });
  if (!alert) throw new HttpError(404, 'Alerte introuvable.');
  res.json(serialize(alert));
});

// GET /api/alerts/:id/timeline
export const getTimeline = asyncHandler(async (req, res) => {
  const events = await prisma.alertEvent.findMany({
    where: { alertId: req.params.id },
    orderBy: { timestamp: 'asc' },
    include: { user: { select: { name: true, role: true } } },
  });
  res.json(events);
});

// POST /api/alerts — manual creation (Mairie) or from a reviewed prediction
// (ANPC/AI-sourced). Always starts at PROPOSED — even an ANPC coordinator's
// own alert passes through the same review step, for a consistent audit
// trail (spec section 9).
export const createAlert = asyncHandler(async (req, res) => {
  const { title, description, type, severity, source, predictionId, zoneIds, channels } = req.body;

  const zones = await prisma.zone.findMany({ where: { id: { in: zoneIds } } });
  if (zones.length !== zoneIds.length) throw new HttpError(400, 'Une ou plusieurs zones sont introuvables.');

  const alert = await prisma.alert.create({
    data: {
      title, description, type, severity, source,
      predictionId: predictionId || null,
      createdById: req.user.id,
      zones: { create: zoneIds.map((zoneId) => ({ zoneId })) },
    },
    include,
  });
  await addEvent(alert.id, req.user.id, 'CREATED', `Alerte proposée (${zones.length} quartier${zones.length > 1 ? 's' : ''})`);
  if (channels?.length) {
    // Channels are recorded now but Notifications are only actually created
    // on dispatch() — proposing an alert must never itself send anything.
  }

  const fresh = await prisma.alert.findUnique({ where: { id: alert.id }, include });
  emit('alert.created', serialize(fresh));
  res.status(201).json(serialize(fresh));
});

async function transition(req, res, { fromStatuses, toStatus, action, details, extraData = {} }) {
  const alert = await prisma.alert.findUnique({ where: { id: req.params.id } });
  if (!alert) throw new HttpError(404, 'Alerte introuvable.');
  if (!fromStatuses.includes(alert.status)) {
    throw new HttpError(409, `Action impossible : l'alerte est au statut ${alert.status}.`);
  }
  const updated = await prisma.alert.update({
    where: { id: alert.id },
    data: { status: toStatus, ...extraData },
    include,
  });
  await addEvent(alert.id, req.user.id, action, details);
  emit('alert.updated', serialize(updated));
  res.json(serialize(updated));
}

// POST /api/alerts/:id/confirm — ANPC only (requireCapability('canConfirm'))
export const confirmAlert = asyncHandler((req, res) =>
  transition(req, res, {
    fromStatuses: ['PROPOSED', 'UNDER_REVIEW'],
    toStatus: 'CONFIRMED',
    action: 'CONFIRMED',
    details: 'Alerte confirmée',
    extraData: { validatedById: req.user.id, validatedAt: new Date() },
  })
);

// POST /api/alerts/:id/request-verification — ANPC only
export const requestVerification = asyncHandler((req, res) =>
  transition(req, res, {
    fromStatuses: ['PROPOSED'],
    toStatus: 'UNDER_REVIEW',
    action: 'VERIFICATION_REQUESTED',
    details: 'Vérification terrain demandée',
  })
);

// POST /api/alerts/:id/reject { reason } — ANPC only, reason mandatory
// (enforced by validators/alertValidators.js). Never deletes the alert.
export const rejectAlert = asyncHandler((req, res) =>
  transition(req, res, {
    fromStatuses: ['PROPOSED', 'UNDER_REVIEW'],
    toStatus: 'CLOSED',
    action: 'REJECTED',
    details: `Alerte rejetée — motif : ${req.body.reason}`,
    extraData: { rejectionReason: req.body.reason, closedAt: new Date() },
  })
);

// POST /api/alerts/:id/dispatch — ANPC only. This is the ONLY step that
// creates Notification rows and actually calls the SMS provider (spec
// section 14) — proposing/confirming an alert never notifies anyone.
export const dispatchAlert = asyncHandler(async (req, res) => {
  const alert = await prisma.alert.findUnique({ where: { id: req.params.id }, include: { zones: true } });
  if (!alert) throw new HttpError(404, 'Alerte introuvable.');
  if (alert.status !== 'CONFIRMED') throw new HttpError(409, `Action impossible : l'alerte est au statut ${alert.status}.`);

  const channels = req.body.channels?.length ? req.body.channels : ['SMS', 'PUSH'];
  await prisma.$transaction(
    channels.map((channel) =>
      prisma.notification.create({ data: { alertId: alert.id, channel, recipient: 'BROADCAST', status: 'PENDING' } })
    )
  );
  if (channels.includes('SMS')) {
    // MOCK by default (see smsService) — logs instead of actually sending
    // until a real SMS_PROVIDER is configured.
    await smsService.sendSMS('BROADCAST', alert.title);
  }
  await prisma.notification.updateMany({ where: { alertId: alert.id }, data: { status: 'SENT', sentAt: new Date() } });

  const updated = await prisma.alert.update({
    where: { id: alert.id },
    data: { status: 'DISPATCHED', dispatchedAt: new Date() },
    include,
  });
  await addEvent(alert.id, req.user.id, 'DISPATCHED', `Diffusée — ${channels.length} canal(aux)`);
  emit('alert.dispatched', serialize(updated));
  res.json(serialize(updated));
});

// POST /api/alerts/:id/field-engage — GNSP/Pompiers only
export const fieldEngage = asyncHandler((req, res) =>
  transition(req, res, {
    fromStatuses: ['DISPATCHED'],
    toStatus: 'ACTIVE',
    action: 'FIELD_ENGAGED',
    details: `Équipe engagée sur le terrain — ${req.user.name}`,
  })
);

// POST /api/alerts/:id/resolve — GNSP/Pompiers only
export const resolveAlert = asyncHandler((req, res) =>
  transition(req, res, {
    fromStatuses: ['ACTIVE'],
    toStatus: 'RESOLVED',
    action: 'RESOLVED',
    details: 'Situation stabilisée',
    extraData: { resolvedAt: new Date() },
  })
);

// POST /api/alerts/:id/close — ANPC only
export const closeAlert = asyncHandler((req, res) =>
  transition(req, res, {
    fromStatuses: ['RESOLVED'],
    toStatus: 'CLOSED',
    action: 'CLOSED',
    details: 'Alerte clôturée',
    extraData: { closedAt: new Date() },
  })
);
