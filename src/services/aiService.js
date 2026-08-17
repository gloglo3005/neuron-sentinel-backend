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

// Normalizes whatever casing/wording the remote API uses for risk_level
// into our RiskLevel enum (LOW/MODERATE/HIGH/CRITICAL — see
// prisma/schema.prisma). Falls back to a probability-based guess if the
// value doesn't match anything recognized, rather than letting an
// unexpected string crash the Prisma insert.
function normalizeRiskLevel(rawLevel, probability) {
  const key = String(rawLevel || '').trim().toUpperCase();
  const known = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
  if (known.includes(key)) return key;
  const synonyms = { MINIMAL: 'LOW', MEDIUM: 'MODERATE', SEVERE: 'CRITICAL', EXTREME: 'CRITICAL' };
  if (synonyms[key]) return synonyms[key];
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
  // Real mode requires both the key and the URL — matches the pattern
  // documented in env.js ("any of these being empty means MOCK mode").
  isMock: !env.aiApiKey || !env.aiApiUrl,

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
      const riskLevel = normalizeRiskLevel(remote.risk_level, probability);
      const confidence = estimateConfidence(probability, horizon);

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

    const riskLevel = probability >= 80 ? 'CRITICAL' : probability >= 55 ? 'HIGH' : probability >= 30 ? 'MODERATE' : 'LOW';

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