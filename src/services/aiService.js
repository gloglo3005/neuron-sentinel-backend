import { env } from '../config/env.js';

// AIProvider interface (spec section 28): generatePrediction(zone, envData).
// MOCK_MODEL_V1 is a simple, fully transparent scoring function — not a
// real ML model — used so the rest of the system (PredictionFactor,
// AIPredictions.jsx waterfall) has real, internally-consistent numbers to
// work with while a real inference service isn't connected.
const MODEL_VERSION_MOCK = 'MOCK_MODEL_V1';

// Real provider: teammate's FastAPI service (Railway). Contract confirmed
// against its live /openapi.json on 2026-08-17:
//   POST {AI_API_URL}/predict
//   body: { zone_id, rainfall_1h, rainfall_6h, humidity }
//   200:  { zone_id, flood_probability, risk_level, prediction_horizon }
//
// Two gaps between that contract and what this system needs — both called
// out explicitly below rather than silently patched over (spec section 33
// — never present fabricated data as real):
//   1. The API returns no `confidence`. Prediction.confidence is a
//      required, non-nullable column, so we compute a stand-in and label
//      it ESTIMATED_CONFIDENCE_HEURISTIC in modelVersion so it's traceable
//      in the data itself, not just in a code comment.
//   2. The API wants `rainfall_6h`, but EnvironmentalData only stores a
//      single point-in-time `rainfall` reading, no rolling 6h sum yet.
//      Approximated here as rainfall_1h * 6 — a flat extrapolation, not an
//      actual accumulation. Revisit once EnvironmentalData aggregation
//      exists (e.g. summing the last 6 hourly rows for the zone).
const REMOTE_MODEL_VERSION = 'NEURON_SENTINEL_REMOTE_v0.1_ESTIMATED_CONFIDENCE_HEURISTIC';

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

// Normalizes whatever casing the remote API uses for risk_level (only
// ever "high" or "low" per the teammate's model — it's a binary
// classifier, no medium/critical tiers). Only used as a sanity check
// against our own probability-derived tier below — never as the value we
// store, since it can't represent MODERATE/CRITICAL at all.
function normalizeBinaryLabel(rawLevel) {
  const key = String(rawLevel || '').trim().toUpperCase();
  return key === 'HIGH' || key === 'LOW' ? key : null;
}

// Single source of truth for the LOW/MODERATE/HIGH/CRITICAL tiers (see
// RiskLevel enum, prisma/schema.prisma) — used by both providers so a
// zone's riskLevel always reflects its actual probability, regardless of
// which model produced it.
//
// This exists because the remote model's own risk_level is a binary
// high/low classification (per teammate) — trusting it directly would
// flatten every zone into just HIGH or LOW forever, so a 95% probability
// zone and a 56% one would carry the identical badge, and
// dashboardController's `criticalZones` count (zones.riskLevel ===
// 'CRITICAL') would never increment even during a severe event. Deriving
// the tier from the continuous probability instead keeps that
// granularity regardless of which provider produced the number.
function riskTierOf(probability) {
  return probability >= 80 ? 'CRITICAL' : probability >= 55 ? 'HIGH' : probability >= 30 ? 'MODERATE' : 'LOW';
}

// The remote model gives no uncertainty estimate at all. This heuristic is
// NOT a real confidence score — it's a rough proxy: predictions near 0 or
// 100 (unambiguous) score higher than predictions near 50 (ambiguous), and
// longer horizons score lower (more time for conditions to change). It
// exists only so Prediction.confidence (required column) isn't a made-up
// constant, and it's clearly named as an estimate in MODEL_VERSION so it
// never gets mistaken for a real model output.
function estimateConfidence(probability, horizon) {
  const decisiveness = Math.abs(probability - 50) * 0.9; // 0 at 50%, up to 45 at 5%/95%
  const horizonPenalty = Math.min(horizon / 24, 1) * 15;
  return Math.round(clamp(55 + decisiveness - horizonPenalty, 35, 95));
}

async function callRemoteModel(zoneId, rainfall1h, rainfall6h, humidity) {
  const url = `${env.aiApiUrl.replace(/\/$/, '')}/predict`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.aiApiKey ? { Authorization: `Bearer ${env.aiApiKey}` } : {}),
      },
      body: JSON.stringify({
        zone_id: zoneId,
        rainfall_1h: rainfall1h,
        rainfall_6h: rainfall6h,
        humidity: humidity ?? 0,
      }),
    });
  } catch (err) {
    throw new Error(`AIProvider injoignable (${url}) — ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`AIProvider ${res.status} — ${body.detail ? JSON.stringify(body.detail) : 'erreur inconnue'}`);
  }
  return res.json();
}

export const aiService = {
  // Real mode only requires the URL — the key is optional (see
  // callRemoteModel: the Authorization header is only sent when a key is
  // configured). Some deployments of the teammate's service (e.g. an
  // open Railway endpoint) don't require auth at all.
  isMock: !env.aiApiUrl,

  /**
   * @param {{ id: string, population: number }} zone
   * @param {{ rainfall: number, humidity?: number }} latestEnv - most recent EnvironmentalData row
   * @param {{ drainScore: number, historyScore: number }} zoneStats - static zone risk inputs
   * @param {number} horizon - hours (1, 3, 6, 24...)
   */
  async generatePrediction(zone, latestEnv, zoneStats, horizon = 6) {
    if (!this.isMock) {
      const rainfall1h = latestEnv?.rainfall ?? 0;
      // See REMOTE_MODEL_VERSION comment above — flat extrapolation, not a
      // real rolling 6h sum yet.
      const rainfall6h = rainfall1h * 6;

      const remote = await callRemoteModel(zone.id, rainfall1h, rainfall6h, latestEnv?.humidity);

      // flood_probability's scale isn't pinned down by the OpenAPI schema
      // (just `number`) — handle both a 0-1 and a 0-100 API without
      // guessing wrong silently.
      const rawProbability = Number(remote.flood_probability) || 0;
      const probability = Math.round(clamp(rawProbability <= 1 ? rawProbability * 100 : rawProbability));
      const riskLevel = riskTierOf(probability);
      const confidence = estimateConfidence(probability, horizon);

      // Sanity check only, never overrides riskLevel above — if the
      // teammate's binary classifier disagrees sharply with our
      // probability-derived tier (e.g. it says "low" at 70%+), that's
      // worth knowing about even though we don't act on it here.
      const binaryLabel = normalizeBinaryLabel(remote.risk_level);
      if (binaryLabel === 'LOW' && probability >= 55) {
        console.warn(`[aiService] Zone ${zone.id}: remote model says LOW but probability is ${probability}% (tier ${riskLevel})`);
      } else if (binaryLabel === 'HIGH' && probability < 30) {
        console.warn(`[aiService] Zone ${zone.id}: remote model says HIGH but probability is only ${probability}% (tier ${riskLevel})`);
      }

      return {
        modelVersion: REMOTE_MODEL_VERSION,
        horizon,
        probability,
        confidence,
        riskLevel,
        // The remote API gives no factor breakdown, so the AIPredictions.jsx
        // waterfall will render an all-zero decomposition for these
        // predictions rather than fabricated contributions — see
        // predictionsService.js's existing "not invented" convention on the
        // frontend side.
        factors: [],
      };
    }

    const base = 20;
    const rainContribution = clamp((latestEnv?.rainfall ?? 0) * 0.6, 0, 45);
    const drainContribution = clamp(50 - (zoneStats?.drainScore ?? 50), -20, 25) * 0.6;
    const histContribution = clamp((zoneStats?.historyScore ?? 0) * 0.3, 0, 25);
    // Horizon dampens confidence and slightly increases projected risk the
    // further out the forecast goes — a simple, explainable stand-in for a
    // real time-series model's uncertainty growth.
    const horizonPenalty = Math.min(horizon / 24, 1) * 8;

    const probability = clamp(base + rainContribution + drainContribution + histContribution + horizonPenalty);
    const confidence = clamp(96 - horizonPenalty * 1.5 - Math.abs(rainContribution - 20) * 0.1, 40, 99);

    const riskLevel = riskTierOf(probability);

    return {
      modelVersion: MODEL_VERSION_MOCK,
      horizon,
      probability: Math.round(probability),
      confidence: Math.round(confidence),
      riskLevel,
      factors: [
        { factor: 'rainfall', value: latestEnv?.rainfall ?? 0, contribution: Math.round(rainContribution) },
        { factor: 'drainage', value: zoneStats?.drainScore ?? 50, contribution: Math.round(drainContribution) },
        { factor: 'history', value: zoneStats?.historyScore ?? 0, contribution: Math.round(histContribution) },
        { factor: 'base', value: base, contribution: base },
      ],
    };
  },
};