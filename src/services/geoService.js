// GeoProvider — real neighbourhood boundaries from OpenStreetMap via the
// Nominatim search API (https://nominatim.org/release-docs/latest/api/Search/).
// Free, no API key required — but Nominatim's usage policy
// (https://operations.osmfoundation.org/policies/nominatim/) requires:
//   - a descriptive User-Agent identifying the application (not a browser UA)
//   - max ~1 request/second, no parallel bulk requests
//   - attribution to OpenStreetMap wherever the data is displayed (already
//     present on the map's TileLayer in ZoneMap.jsx)
//
// Unlike weatherService.js, there's no MOCK/real switch gated by an API
// key here — Nominatim itself is the free tier, always available. A zone
// whose lookup fails just keeps its existing placeholder circle geometry
// (Zone.geometry stays null) rather than the whole sync failing.

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'NeuronSentinel/1.0 (projet étudiant — early-warning inondations Lomé)';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const geoService = {
  // Looks up one neighbourhood's real polygon boundary. `zoneName` should
  // be the plain quartier name (e.g. "Bè", "Baguida") — city/country are
  // appended here to disambiguate.
  async getBoundary(zoneName) {
    const q = `${zoneName}, Lomé, Togo`;
    const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(q)}&format=jsonv2&polygon_geojson=1&limit=1`;
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    } catch (err) {
      throw new Error(`OpenStreetMap injoignable (${err.message})`);
    }
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const results = await res.json();
    const match = results[0];
    if (!match?.geojson) throw new Error(`Aucun contour trouvé pour "${zoneName}"`);
    // Nominatim sometimes returns a Point (no real boundary indexed for
    // that place) instead of a Polygon/MultiPolygon — not usable as a map
    // shape, so treat it the same as "not found".
    if (!['Polygon', 'MultiPolygon'].includes(match.geojson.type)) {
      throw new Error(`Contour non polygonal pour "${zoneName}" (${match.geojson.type})`);
    }
    return {
      type: 'Feature',
      properties: { name: zoneName, osmId: match.osm_id, source: 'OpenStreetMap' },
      geometry: match.geojson,
    };
  },

  // Sequential by design (1 req/s) — see Nominatim usage policy above.
  // `zones` is an array of { id, name }. Returns { id, geometry } for
  // every zone that resolved, and logs (doesn't throw on) the rest.
  async getBoundaries(zones) {
    const results = [];
    for (const zone of zones) {
      try {
        const feature = await this.getBoundary(zone.name);
        results.push({ id: zone.id, geometry: feature, error: null });
      } catch (err) {
        results.push({ id: zone.id, geometry: null, error: err.message });
      }
      await sleep(1100); // stay under Nominatim's 1 req/s limit
    }
    return results;
  },
};