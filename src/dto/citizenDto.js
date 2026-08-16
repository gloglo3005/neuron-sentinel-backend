// Response shapes dedicated to the citizen PWA (spec section 11 — never
// return raw Prisma models to the citizen). Each function below picks only
// the fields a citizen is allowed to see; anything internal (AI model
// internals, other users, audit data, raw provider payloads) never enters
// these objects in the first place.

export function zoneSummaryDto(zone, { environmental, prediction, alert } = {}) {
  return {
    id: zone.id,
    name: zone.name,
    riskLevel: zone.riskLevel,
    weather: environmental
      ? {
          rainfall: environmental.rainfall,
          temperature: environmental.temperature,
          humidity: environmental.humidity,
          windSpeed: environmental.windSpeed,
          observedAt: environmental.timestamp,
          isMock: environmental.source === 'MOCK',
        }
      : null,
    risk: prediction
      ? {
          level: prediction.riskLevel,
          probability: prediction.probability,
          horizon: prediction.horizon,
          generatedAt: prediction.generatedAt,
        }
      : null,
    activeAlert: alert ? alertSummaryDto(alert) : null,
  };
}

export function alertSummaryDto(alert) {
  return {
    id: alert.id,
    title: alert.title,
    description: alert.description,
    type: alert.type,
    severity: alert.severity,
    status: alert.status,
    zones: (alert.zones || []).map((z) => z.zone?.name ?? z.name).filter(Boolean),
    dispatchedAt: alert.dispatchedAt,
    resolvedAt: alert.resolvedAt,
    // Set by citizenController before calling this dto (see
    // attachAcknowledged) — whether *this* citizen has already
    // acknowledged this alert. Defaults to false so callers that don't
    // bother attaching it (there are none left, but just in case) don't
    // crash the PWA.
    acknowledged: alert.acknowledged ?? false,
  };
}

export function reportSummaryDto(report) {
  return {
    id: report.id,
    type: report.type,
    description: report.description,
    status: report.status,
    latitude: report.latitude,
    longitude: report.longitude,
    createdAt: report.createdAt,
    media: (report.media || []).map((m) => ({ type: m.type, url: m.url })),
  };
}