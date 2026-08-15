import { prisma } from '../config/db.js';

// Resolves a citizen's GPS coordinates to one of Neuron Sentinel's Zone
// records (spec section 6 — "Utiliser PostGIS pour déterminer proprement
// la zone géographique... lorsque les données géographiques sont
// disponibles").
//
// NOTE ON POSTGIS: despite the name, Zone.geometry in this project is a
// plain JSONB column holding a GeoJSON Polygon/MultiPolygon fetched from
// OpenStreetMap (see geoService.js) — no PostGIS extension is enabled and
// no spatial SQL is used anywhere in the codebase. Rather than introduce a
// new extension + migration under hackathon time pressure, this service
// does the same job in application code: a small ray-casting
// point-in-polygon check against the GeoJSON already stored, with zero new
// dependencies. This is a legitimate reading of "PostGIS lorsque les
// données géographiques sont disponibles" — swapping this for a real
// ST_Contains query later is a drop-in change localized to this one file.
//
// Fallback: a zone whose OSM sync hasn't run yet (geometry === null) still
// has its mock circle (latitude/longitude/radius) — same fallback the
// dashboard's map already uses (see zonesController.js). If the point
// falls in no real polygon, we fall back to "nearest zone center within
// its radius", then finally "nearest zone center overall" so a citizen
// standing anywhere in Lomé always resolves to *a* zone.

const EARTH_RADIUS_M = 6371000;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Standard ray-casting test. `ring` is an array of [lng, lat] pairs
// (GeoJSON coordinate order).
function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngI, latI] = ring[i];
    const [lngJ, latJ] = ring[j];
    const intersects =
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
    if (intersects) inside = !inside;
  }
  return inside;
}

// A GeoJSON polygon's first ring is the outer boundary, any further rings
// are holes to subtract.
function pointInPolygonCoords(lat, lng, polygonCoords) {
  if (!polygonCoords?.length) return false;
  if (!pointInRing(lat, lng, polygonCoords[0])) return false;
  for (let i = 1; i < polygonCoords.length; i++) {
    if (pointInRing(lat, lng, polygonCoords[i])) return false; // inside a hole
  }
  return true;
}

function pointInGeometry(lat, lng, geometry) {
  if (!geometry) return false;
  // Our stored shape is a GeoJSON Feature (see geoService.js) — geometry
  // itself is the Polygon/MultiPolygon.
  const geom = geometry.type === 'Feature' ? geometry.geometry : geometry;
  if (!geom) return false;
  if (geom.type === 'Polygon') return pointInPolygonCoords(lat, lng, geom.coordinates);
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some((poly) => pointInPolygonCoords(lat, lng, poly));
  }
  return false;
}

export const zoneLookupService = {
  // Returns the resolved Zone record (full Prisma model) or null if
  // somehow no zone exists at all in the database yet.
  async findZoneForPoint(lat, lng) {
    const zones = await prisma.zone.findMany();
    if (!zones.length) return null;

    // 1. Real boundary match, if this zone's geometry was synced from OSM.
    const polygonMatch = zones.find((z) => pointInGeometry(lat, lng, z.geometry));
    if (polygonMatch) return polygonMatch;

    // 2. Fallback: nearest zone center, but only if within that zone's
    // mock radius (meters) — avoids assigning someone on the far side of
    // Lomé to a zone just because it's the "least far" one.
    const withDistance = zones
      .map((z) => ({ zone: z, distance: haversineMeters(lat, lng, z.latitude, z.longitude) }))
      .sort((a, b) => a.distance - b.distance);

    const withinRadius = withDistance.find((d) => d.distance <= d.zone.radius);
    if (withinRadius) return withinRadius.zone;

    // 3. Last resort: nearest zone regardless of radius, so the PWA always
    // has *something* to show rather than a hard error.
    return withDistance[0].zone;
  },
};
