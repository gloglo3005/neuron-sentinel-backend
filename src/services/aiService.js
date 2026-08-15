import { env } from '../config/env.js';

// AIProvider interface (spec section 28): generatePrediction(zone, envData).
// MOCK_MODEL_V1 is a simple, fully transparent scoring function — not a
// real ML model — used so the rest of the system (PredictionFactor,
// AIPredictions.jsx waterfall) has real, internally-consistent numbers to
// work with while a real inference service isn't connected.
const MODEL_VERSION = 'MOCK_MODEL_V1';

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

export const aiService = {
  isMock: !env.aiApiKey,

  /**
   * @param {{ id: string, population: number }} zone
   * @param {{ rainfall: number }} latestEnv - most recent EnvironmentalData row
   * @param {{ drainScore: number, historyScore: number }} zoneStats - static zone risk inputs
   * @param {number} horizon - hours (1, 3, 6, 24...)
   */
  async generatePrediction(zone, latestEnv, zoneStats, horizon = 6) {
    if (!this.isMock) {
      throw new Error('AIProvider réel non implémenté — AI_API_KEY est défini mais aucun client d\'inférence n\'est branché.');
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
      modelVersion: MODEL_VERSION,
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
