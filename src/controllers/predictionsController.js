import { prisma } from '../config/db.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { aiService } from '../services/aiService.js';

// GET /api/predictions?zoneId=&horizon=
export const listPredictions = asyncHandler(async (req, res) => {
  const { zoneId, horizon } = req.query;
  const where = {};
  if (zoneId) where.zoneId = zoneId;
  if (horizon) where.horizon = Number(horizon);

  const predictions = await prisma.prediction.findMany({
    where,
    include: { factors: true, outcome: true, zone: { select: { name: true } } },
    orderBy: { generatedAt: 'desc' },
    take: 100,
  });
  res.json(predictions);
});

// GET /api/predictions/:id
export const getPrediction = asyncHandler(async (req, res) => {
  const prediction = await prisma.prediction.findUnique({
    where: { id: req.params.id },
    include: { factors: true, outcome: true, zone: true },
  });
  if (!prediction) throw new HttpError(404, 'Prédiction introuvable.');
  res.json(prediction);
});

// POST /api/predictions/generate  { zoneId, horizon }
// Runs the AIProvider (MOCK by default — see src/services/aiService.js)
// against the zone's latest environmental reading and persists both the
// Prediction and its PredictionFactor breakdown, so AIPredictions.jsx's
// waterfall always reflects a real row instead of a hard-coded one.
export const generatePrediction = asyncHandler(async (req, res) => {
  const { zoneId, horizon = 6 } = req.body;
  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!zone) throw new HttpError(404, 'Zone introuvable.');

  const latestEnv = await prisma.environmentalData.findFirst({
    where: { zoneId: zone.id },
    orderBy: { timestamp: 'desc' },
  });

  const result = await aiService.generatePrediction(
    zone,
    latestEnv ?? { rainfall: zone.rainScore },
    { drainScore: zone.drainScore, historyScore: zone.historyScore },
    horizon
  );

  const prediction = await prisma.prediction.create({
    data: {
      zoneId: zone.id,
      horizon: result.horizon,
      probability: result.probability,
      riskLevel: result.riskLevel,
      confidence: result.confidence,
      modelVersion: result.modelVersion,
      validUntil: new Date(Date.now() + horizon * 3600_000),
      factors: { create: result.factors },
    },
    include: { factors: true },
  });

  res.status(201).json(prediction);
});
