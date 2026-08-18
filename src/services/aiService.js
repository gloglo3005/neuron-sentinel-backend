import { env } from '../config/env.js';

// Nos 13 quartiers (backend/prisma/seed.js) et les 13 cantons du modèle
// distant (data/processed/lome_fri.gpkg côté service IA) ne sont pas le
// même découpage administratif : nos quartiers ("villes") sont plus fins
// que les cantons du Grand Lomé utilisés par le modèle. Seuls deux noms
// coïncidaient par hasard (Amoutivé, Baguida) — les 11 autres quartiers
// renvoyaient 404 côté service distant et retombaient silencieusement sur
// le mock local.
//
// Cette table n'est PAS une supposition : elle vient d'un vrai test
// point-dans-polygone entre les coordonnées de chaque quartier (seed.js)
// et les polygones réels des cantons (lome_fri.gpkg, reprojetés
// UTM31N -> comparés en mètres). 12/13 quartiers tombent littéralement
// à l'intérieur d'un polygone de canton ; Baguida n'est pas contenu au
// sens strict (à 2,75 km du centroïde du canton Baguida) mais matche par
// nom ET reste de très loin le plus proche, ce qui confirme le calcul.
// Si le découpage venait à changer côté service IA, cette table devra
// être régénérée de la même façon plutôt que corrigée à la main.
const ZONE_TO_CANTON = {
  'Bè': 'Amoutivé',
  'Kodjoviakopé': 'Amoutivé',
  'Amoutivé': 'Amoutivé',
  'Tokoin': 'Bè-Ouest',
  'Djidjolé': 'Bè-Ouest',
  'Adidogomé': 'Aflao-Gakli',
  'Agoè': 'Bè-Ouest',
  'Baguida': 'Baguida',
  'Hédzranawoé': 'Bè-Centre',
  'Nyékonakpoè': 'Amoutivé',
  'Akodesséwa': 'Bè-Est',
  'Doulassamé': 'Amoutivé',
  'Hanoukopé': 'Amoutivé',
};

// AIProvider interface (spec section 28): generatePrediction(zone, envData).
//
// MOCK_MODEL_V1 is a simple, fully transparent scoring function — not a
// real ML model — used as a fallback so the rest of the system can continue
// working when the remote inference service is unavailable.
const MODEL_VERSION_MOCK = 'MOCK_MODEL_V1';

// Real provider: teammate's FastAPI service.
//
// Contract:
//   POST {AI_API_URL}/predict
//
// Body:
//   {
//     zone_id,
//     rainfall_1h,
//     rainfall_6h,
//     humidity
//   }
//
// IMPORTANT:
// The remote API expects `zone_id` to contain the zone/canton name used by
// the AI dataset (canton_nom), NOT our local Prisma Zone.id.
//
// Example:
//   local Prisma ID: "cmsqju7290004domk36uafny6"
//   local zone name: "Bè"
//   remote zone_id:  "Bè"
//
// The previous implementation incorrectly sent zone.id, which caused:
//   404 — "Zone inconnue: cmsqju7290004domk36uafny6"
//
// The remote API response is expected to contain:
//   {
//     zone_id,
//     flood_probability,
//     risk_level,
//     prediction_horizon
//   }
//
// The remote API does not currently return `confidence`, so this service
// computes an explicitly labelled heuristic confidence value.
//
// It also expects rainfall_6h while EnvironmentalData currently stores
// only a point-in-time rainfall value. Until a real rolling 6h aggregation
// exists, rainfall_6h is approximated as rainfall_1h * 6.
const REMOTE_MODEL_VERSION =
  'NEURON_SENTINEL_REMOTE_v0.1_ESTIMATED_CONFIDENCE_HEURISTIC';

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

// Normalizes the binary risk label returned by the remote model.
// The remote model currently returns only HIGH or LOW.
// This is used only as a sanity check; the final risk level stored by our
// backend is derived from the continuous flood probability.
function normalizeBinaryLabel(rawLevel) {
  const key = String(rawLevel || '').trim().toUpperCase();

  return key === 'HIGH' || key === 'LOW' ? key : null;
}

// Single source of truth for our four risk tiers.
//
// The remote model uses a binary HIGH/LOW classification, but our dashboard
// needs LOW/MODERATE/HIGH/CRITICAL. Therefore we derive the final tier from
// the continuous probability returned by the remote model.
function riskTierOf(probability) {
  return probability >= 80
    ? 'CRITICAL'
    : probability >= 55
      ? 'HIGH'
      : probability >= 30
        ? 'MODERATE'
        : 'LOW';
}

// The remote model does not provide an uncertainty/confidence score.
// This is therefore only a transparent heuristic and must never be
// presented as an actual model confidence.
function estimateConfidence(probability, horizon) {
  const decisiveness = Math.abs(probability - 50) * 0.9;
  const horizonPenalty = Math.min(horizon / 24, 1) * 15;

  return Math.round(
    clamp(55 + decisiveness - horizonPenalty, 35, 95)
  );
}

/**
 * Call the teammate's remote AI service.
 *
 * IMPORTANT:
 * `cantonName` is deliberately used here instead of the local Prisma
 * `zone.id` — AND instead of the raw local `zone.name`.
 *
 * The AI dataset uses `canton_nom` as its zone identifier, and our
 * quartiers don't share the same boundaries as the AI's cantons (see
 * ZONE_TO_CANTON above). The caller is responsible for translating
 * zone.name through ZONE_TO_CANTON before calling this function.
 *
 * @param {string} cantonName
 * @param {number} rainfall1h
 * @param {number} rainfall6h
 * @param {number} humidity
 */
async function callRemoteModel(
  cantonName,
  rainfall1h,
  rainfall6h,
  humidity
) {
  if (!cantonName) {
    throw new Error(
      'AIProvider — impossible de déterminer le canton correspondant à cette zone'
    );
  }

  const url = `${env.aiApiUrl.replace(/\/$/, '')}/predict`;

  let res;

  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',

        ...(env.aiApiKey
          ? {
              Authorization: `Bearer ${env.aiApiKey}`,
            }
          : {}),
      },

      body: JSON.stringify({
        // IMPORTANT:
        // The remote AI expects the canton name (see ZONE_TO_CANTON), not
        // our Prisma ID and not our raw quartier name.
        zone_id: cantonName,

        rainfall_1h: rainfall1h,
        rainfall_6h: rainfall6h,
        humidity: humidity ?? 0,
      }),
    });
  } catch (err) {
    throw new Error(
      `AIProvider injoignable (${url}) — ${err.message}`
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    throw new Error(
      `AIProvider ${res.status} — ${
        body.detail
          ? JSON.stringify(body.detail)
          : 'erreur inconnue'
      }`
    );
  }

  return res.json();
}

export const aiService = {
  // Real mode only requires AI_API_URL.
  // The API key remains optional because the teammate's endpoint may not
  // require authentication.
  isMock: !env.aiApiUrl,

  /**
   * @param {{
   *   id: string,
   *   name: string,
   *   population: number
   * }} zone
   *
   * @param {{
   *   rainfall: number,
   *   humidity?: number
   * }} latestEnv
   *
   * @param {{
   *   drainScore: number,
   *   historyScore: number
   * }} zoneStats
   *
   * @param {number} horizon
   */
  async generatePrediction(
    zone,
    latestEnv,
    zoneStats,
    horizon = 6
  ) {
    if (!this.isMock) {
      try {
        const rainfall1h = latestEnv?.rainfall ?? 0;

        // Temporary approximation until EnvironmentalData supports
        // a real rolling 6-hour rainfall aggregation.
        const rainfall6h = rainfall1h * 6;

        // IMPORTANT:
        // Send the CANTON name to the remote AI, NOT zone.id and NOT the
        // raw zone.name — our quartiers and the AI's cantons are two
        // different administrative breakdowns (see ZONE_TO_CANTON above).
        //
        // Example:
        //   zone.id       = "cmsqju7290004domk36uafny6"
        //   zone.name     = "Bè"        (notre quartier)
        //   canton envoyé = "Amoutivé"  (canton réel qui le contient)
        const cantonName = ZONE_TO_CANTON[zone.name];
        if (!cantonName) {
          throw new Error(
            `Aucun canton connu pour le quartier "${zone.name}" — ` +
              'ZONE_TO_CANTON doit être complétée si de nouveaux quartiers sont ajoutés.'
          );
        }

        const remote = await callRemoteModel(
          cantonName,
          rainfall1h,
          rainfall6h,
          latestEnv?.humidity
        );

        // flood_probability may be returned either as:
        //   0.82
        // or:
        //   82
        //
        // Normalize both representations to 0–100.
        const rawProbability =
          Number(remote.flood_probability) || 0;

        const probability = Math.round(
          clamp(
            rawProbability <= 1
              ? rawProbability * 100
              : rawProbability
          )
        );

        const riskLevel = riskTierOf(probability);

        const confidence = estimateConfidence(
          probability,
          horizon
        );

        // The remote model provides only a binary HIGH/LOW label.
        // We keep it only for consistency checking and derive our own
        // four-level risk tier from flood_probability.
        const binaryLabel = normalizeBinaryLabel(
          remote.risk_level
        );

        if (
          binaryLabel === 'LOW' &&
          probability >= 55
        ) {
          console.warn(
            `[aiService] Zone ${zone.name}: remote model says LOW but probability is ${probability}% (tier ${riskLevel})`
          );
        } else if (
          binaryLabel === 'HIGH' &&
          probability < 30
        ) {
          console.warn(
            `[aiService] Zone ${zone.name}: remote model says HIGH but probability is only ${probability}% (tier ${riskLevel})`
          );
        }

        console.log(
          `[aiService] Prédiction distante réussie pour ${zone.name}: ${probability}% (${riskLevel})`
        );

        return {
          modelVersion: REMOTE_MODEL_VERSION,
          horizon,
          probability,
          confidence,
          riskLevel,

          // The remote API does not provide factor contributions.
          // We therefore do NOT invent them.
          factors: [],
        };
      } catch (err) {
        // If the remote AI is unavailable or does not know the zone,
        // fall back to the local transparent model.
        //
        // The fallback is explicitly labelled so the dashboard never
        // mistakes it for a real remote AI prediction.
        console.warn(
          `[aiService] AIProvider distant indisponible pour la zone ${zone.name}, repli sur le modèle local: ${err.message}`
        );

        const fallback =
          this._localMockPrediction(
            zone,
            latestEnv,
            zoneStats,
            horizon
          );

        fallback.modelVersion =
          `${MODEL_VERSION_MOCK}_FALLBACK_REMOTE_UNAVAILABLE`;

        return fallback;
      }
    }

    return this._localMockPrediction(
      zone,
      latestEnv,
      zoneStats,
      horizon
    );
  },

  /**
   * Transparent local fallback.
   *
   * This is NOT a machine-learning model.
   * It exists only so the application remains functional when the remote
   * inference service cannot be reached.
   */
  _localMockPrediction(
    zone,
    latestEnv,
    zoneStats,
    horizon = 6
  ) {
    const base = 20;

    const rainContribution = clamp(
      (latestEnv?.rainfall ?? 0) * 0.6,
      0,
      45
    );

    const drainContribution =
      clamp(
        50 - (zoneStats?.drainScore ?? 50),
        -20,
        25
      ) * 0.6;

    const histContribution = clamp(
      (zoneStats?.historyScore ?? 0) * 0.3,
      0,
      25
    );

    // Further horizons slightly increase projected risk while reducing
    // confidence.
    const horizonPenalty =
      Math.min(horizon / 24, 1) * 8;

    const probability = clamp(
      base +
        rainContribution +
        drainContribution +
        histContribution +
        horizonPenalty
    );

    const confidence = clamp(
      96 -
        horizonPenalty * 1.5 -
        Math.abs(rainContribution - 20) * 0.1,
      40,
      99
    );

    const riskLevel = riskTierOf(probability);

    return {
      modelVersion: MODEL_VERSION_MOCK,
      horizon,
      probability: Math.round(probability),
      confidence: Math.round(confidence),
      riskLevel,

      factors: [
        {
          factor: 'rainfall',
          value: latestEnv?.rainfall ?? 0,
          contribution: Math.round(
            rainContribution
          ),
        },

        {
          factor: 'drainage',
          value:
            zoneStats?.drainScore ?? 50,
          contribution: Math.round(
            drainContribution
          ),
        },

        {
          factor: 'history',
          value:
            zoneStats?.historyScore ?? 0,
          contribution: Math.round(
            histContribution
          ),
        },

        {
          factor: 'base',
          value: base,
          contribution: base,
        },
      ],
    };
  },
};