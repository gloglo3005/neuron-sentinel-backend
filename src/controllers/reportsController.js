import { prisma } from '../config/db.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';

// GET /api/reports — one row per CLOSED/RESOLVED alert, with the full
// chain attached so an authority can retrace exactly what happened.
export const listReports = asyncHandler(async (req, res) => {
  const alerts = await prisma.alert.findMany({
    where: { status: { in: ['RESOLVED', 'CLOSED'] } },
    include: {
      zones: { include: { zone: { select: { name: true, population: true } } } },
      events: { orderBy: { timestamp: 'asc' } },
      prediction: { include: { outcome: true } },
      interventions: { include: { teams: { include: { team: true } } } },
      createdBy: { select: { name: true, role: true } },
      validatedBy: { select: { name: true, role: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(alerts);
});

// POST /api/reports { alertId, damages: [{ type, quantity, severity, source, infrastructureId? }] }
// "Creating" a report here means attaching the post-event damage
// assessment to a resolved alert's underlying EmergencyEvent — not
// generating a PDF (that stays a frontend/export concern).
export const createReport = asyncHandler(async (req, res) => {
  const { alertId, damages = [] } = req.body;
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new HttpError(404, 'Alerte introuvable.');
  if (!['RESOLVED', 'CLOSED'].includes(alert.status)) {
    throw new HttpError(409, "Un rapport de dégâts ne peut être ajouté qu'une fois l'alerte résolue.");
  }

  const created = await prisma.$transaction(
    damages.map((d) =>
      prisma.damageReport.create({
        data: {
          type: d.type, quantity: d.quantity ?? null, severity: d.severity, source: d.source || 'Autorité',
          infrastructureId: d.infrastructureId || null, verified: true, verifiedById: req.user.id,
        },
      })
    )
  );
  res.status(201).json({ alertId, damages: created });
});
