import { env } from '../config/env.js';

// SatelliteProvider interface (spec sections 19, 28). MOCK mode is active
// whenever SATELLITE_API_KEY is unset — every observation this returns is
// tagged source: 'MOCK' and must be stored/displayed as such (spec section
// 19: "Ne pas simuler une véritable donnée satellite en prétendant qu'elle
// vient d'un satellite réel").
export const satelliteService = {
  isMock: !env.satelliteApiKey,

  async getLatestObservation(zone) {
    if (!this.isMock) {
      throw new Error('SatelliteProvider réel non implémenté — SATELLITE_API_KEY est défini mais aucun client HTTP n\'est branché.');
    }
    return {
      source: 'MOCK',
      zoneId: zone.id,
      observedAt: new Date().toISOString(),
      floodIndicator: false,
      waterExtent: null,
      confidence: 0,
      metadata: { note: 'Aucune source satellite réelle connectée — placeholder MOCK.' },
    };
  },
};
