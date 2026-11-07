import { haversineMeters, type AiPlace, type LatLng, type WeatherNow } from '@unfog/core';

/** Free OpenStreetMap services. Their usage policies ask for an identifying User-Agent. */
const UA = 'Haunts/0.1 (city exploration app)';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const PHOTON = 'https://photon.komoot.io/api/';
const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

export type Fetcher = typeof fetch;

async function getJson<T>(f: Fetcher, url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const res = await f(url, { ...init, headers: { 'user-agent': UA, accept: 'application/json', ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

// shortcut: in-process TTL cache, per server instance; move to Redis if several instances run.
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return value;
}

// Nominatim allows one request per second.
let nominatimNext = 0;
async function nominatimSlot(): Promise<void> {
  const wait = nominatimNext - Date.now();
  nominatimNext = Math.max(Date.now(), nominatimNext) + 1100;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

// ---------------------------------------------------------------- places

/** Categories the companion can search, mapped to OpenStreetMap tags. */
export const PLACE_CATEGORIES = {
  cafe: ['amenity', 'cafe'],
  restaurant: ['amenity', 'restaurant'],
  fast_food: ['amenity', 'fast_food'],
  bar: ['amenity', 'bar'],
  pub: ['amenity', 'pub'],
  ice_cream: ['amenity', 'ice_cream'],
  bakery: ['shop', 'bakery'],
  bookshop: ['shop', 'books'],
  library: ['amenity', 'library'],
  park: ['leisure', 'park'],
  garden: ['leisure', 'garden'],
  gym: ['leisure', 'fitness_centre'],
  sports: ['leisure', 'sports_centre'],
  museum: ['tourism', 'museum'],
  gallery: ['tourism', 'gallery'],
  attraction: ['tourism', 'attraction'],
  viewpoint: ['tourism', 'viewpoint'],
  cinema: ['amenity', 'cinema'],
  theatre: ['amenity', 'theatre'],
  coworking: ['amenity', 'coworking_space'],
  marketplace: ['amenity', 'marketplace'],
  mall: ['shop', 'mall'],
  temple: ['amenity', 'place_of_worship'],
  pharmacy: ['amenity', 'pharmacy'],
  hospital: ['amenity', 'hospital'],
  atm: ['amenity', 'atm'],
  toilets: ['amenity', 'toilets'],
  metro: ['station', 'subway'],
  bus_stop: ['highway', 'bus_stop'],
} as const satisfies Record<string, readonly [string, string]>;
export type PlaceCategory = keyof typeof PLACE_CATEGORIES;

const DETAIL_TAGS = ['cuisine', 'internet_access', 'outdoor_seating', 'wheelchair', 'website', 'phone', 'diet:vegetarian', 'description', 'brand', 'level'];

type RawPlace = { osm: string; name: string; category: string; lat: number; lng: number; tags: Record<string, string>; address?: string | null };

function toPlace(r: RawPlace, from: LatLng): AiPlace {
  const details: Record<string, string> = {};
  for (const k of DETAIL_TAGS) if (r.tags[k]) details[k] = r.tags[k].slice(0, 120);
  const addr = r.address ?? ([r.tags['addr:street'], r.tags['addr:suburb'] ?? r.tags['addr:city']].filter(Boolean).join(', ') || null);
  return {
    id: r.osm,
    name: r.name.slice(0, 80),
    category: r.category,
    lat: Number(r.lat.toFixed(6)),
    lng: Number(r.lng.toFixed(6)),
    distanceM: Math.round(haversineMeters(from, r)),
    address: addr,
    openingHours: r.tags.opening_hours?.slice(0, 120) ?? null,
    details,
  };
}

async function overpassSearch(f: Fetcher, at: LatLng, radiusM: number, category: PlaceCategory): Promise<RawPlace[]> {
  const [k, v] = PLACE_CATEGORIES[category];
  const q = `[out:json][timeout:8];nwr(around:${radiusM},${at.lat},${at.lng})["${k}"="${v}"]["name"];out center tags 40;`;
  let lastErr: unknown;
  for (const url of OVERPASS) {
    try {
      const r = await getJson<{ elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] }>(
        f,
        `${url}?data=${encodeURIComponent(q)}`,
        {},
        9000,
      );
      return r.elements
        .map((e) => ({ e, p: e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null) }))
        .filter((x): x is { e: (typeof r.elements)[number]; p: { lat: number; lon: number } } => x.p !== null && !!x.e.tags?.name)
        .map(({ e, p }) => ({ osm: `${e.type[0]}${e.id}`, name: e.tags!.name!, category, lat: p.lat, lng: p.lon, tags: e.tags! }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function viewbox(at: LatLng, radiusM: number): string {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((at.lat * Math.PI) / 180));
  return `${at.lng - dLng},${at.lat + dLat},${at.lng + dLng},${at.lat - dLat}`;
}

async function nominatimSearch(f: Fetcher, at: LatLng, radiusM: number, category: PlaceCategory): Promise<RawPlace[]> {
  const [, v] = PLACE_CATEGORIES[category];
  await nominatimSlot();
  const url = `${NOMINATIM}?amenity=${encodeURIComponent(v)}&format=jsonv2&limit=40&bounded=1&extratags=1&addressdetails=1&viewbox=${viewbox(at, radiusM)}`;
  const rows = await getJson<{ osm_type: string; osm_id: number; lat: string; lon: string; name: string; type: string; extratags?: Record<string, string>; address?: Record<string, string> }[]>(f, url);
  return rows
    .filter((r) => r.name && r.type === v)
    .map((r) => ({
      osm: `${r.osm_type[0]}${r.osm_id}`,
      name: r.name,
      category,
      lat: Number(r.lat),
      lng: Number(r.lon),
      tags: r.extratags ?? {},
      address: [r.address?.road, r.address?.suburb ?? r.address?.neighbourhood].filter(Boolean).join(', ') || null,
    }));
}

/** Free-text search (names, brands, "rooftop"), biased to the user's area. */
async function photonSearch(f: Fetcher, at: LatLng, radiusM: number, query: string): Promise<RawPlace[]> {
  const bbox = viewbox(at, radiusM).split(',').map(Number);
  const url = `${PHOTON}?q=${encodeURIComponent(query)}&lat=${at.lat}&lon=${at.lng}&limit=25&bbox=${bbox[0]},${bbox[3]},${bbox[2]},${bbox[1]}`;
  const r = await getJson<{ features: { geometry: { coordinates: [number, number] }; properties: Record<string, string | number> }[] }>(f, url);
  return r.features
    .filter((x) => x.properties.name)
    .map((x) => ({
      osm: `${String(x.properties.osm_type ?? 'n').toLowerCase()}${x.properties.osm_id}`,
      name: String(x.properties.name),
      category: String(x.properties.osm_value ?? 'place'),
      lat: x.geometry.coordinates[1],
      lng: x.geometry.coordinates[0],
      tags: {},
      address: [x.properties.street, x.properties.locality ?? x.properties.district].filter(Boolean).join(', ') || null,
    }));
}

let overpassDownUntil = 0;

export async function searchPlaces(
  f: Fetcher,
  at: LatLng,
  opts: { radiusM: number; category?: PlaceCategory; query?: string; limit: number },
): Promise<AiPlace[]> {
  const radiusM = Math.min(Math.max(opts.radiusM, 100), 5000);
  const key = `places:${at.lat.toFixed(3)},${at.lng.toFixed(3)}:${radiusM}:${opts.category ?? ''}:${opts.query ?? ''}`;
  const raw = await cached(key, 30 * 60_000, async () => {
    if (opts.query) return photonSearch(f, at, radiusM, opts.query);
    const category = opts.category ?? 'cafe';
    if (Date.now() >= overpassDownUntil) {
      try {
        return await overpassSearch(f, at, radiusM, category);
      } catch {
        // The public Overpass servers are often at capacity. Skip them for a while instead of
        // waiting out their timeouts on every search.
        overpassDownUntil = Date.now() + 5 * 60_000;
      }
    }
    return nominatimSearch(f, at, radiusM, category);
  });
  const seen = new Set<string>();
  return raw
    .map((r) => toPlace(r, at))
    .filter((p) => p.distanceM <= radiusM * 1.2 && !seen.has(p.id) && seen.add(p.id))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, opts.limit);
}

/** Named things around a block, for walking-guide stories. */
export async function landmarksNear(f: Fetcher, at: LatLng): Promise<string[]> {
  return cached(`landmarks:${at.lat.toFixed(4)},${at.lng.toFixed(4)}`, 24 * 3_600_000, async () => {
    const kinds = ['attraction', 'temple', 'park', 'restaurant', 'cafe'] as const;
    const found = await Promise.all(kinds.map((category) => searchPlaces(f, at, { radiusM: 250, category, limit: 3 }).catch(() => [])));
    return found.flatMap((ps, i) => ps.map((p) => `${p.name} (${kinds[i]}, ${p.distanceM} m)`)).slice(0, 12);
  });
}

// ---------------------------------------------------------------- routing

export type WalkGeometry = { distanceM: number; durationMin: number; coordinates: [number, number][] };

/** Walking route through the points in order, on real streets. */
export async function walkingRoute(f: Fetcher, points: LatLng[]): Promise<WalkGeometry> {
  if (points.length < 2 || points.length > 12) throw new Error('A route needs 2 to 12 points');
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const r = await cached(`route:${coords}`, 6 * 3_600_000, () =>
    getJson<{ code: string; routes: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] }>(
      f,
      `${OSRM_FOOT}/${coords}?overview=full&geometries=geojson`,
      {},
      15_000,
    ),
  );
  const route = r.routes[0];
  if (r.code !== 'Ok' || !route) throw new Error('No walking route found');
  return {
    distanceM: Math.round(route.distance),
    // OSRM's foot profile is quick for Bengaluru pavements; 4.5 km/h is closer to reality.
    durationMin: Math.max(1, Math.round(route.distance / 75)),
    coordinates: simplify(route.geometry.coordinates, 400),
  };
}

/** Keeps every nth point so the route stays small enough to send to the phone. */
export function simplify(coords: [number, number][], max: number): [number, number][] {
  const round = (c: [number, number]): [number, number] => [Number(c[0].toFixed(5)), Number(c[1].toFixed(5))];
  if (coords.length <= max) return coords.map(round);
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => round(coords[Math.round(i * step)]!));
}

// ---------------------------------------------------------------- weather

const WMO: Record<number, string> = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  80: 'rain showers', 81: 'heavy showers', 82: 'violent showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};

export async function weatherAt(f: Fetcher, at: LatLng, now = new Date()): Promise<WeatherNow> {
  const lat = at.lat.toFixed(2);
  const lng = at.lng.toFixed(2);
  const r = await cached(`weather:${lat},${lng}`, 15 * 60_000, () =>
    getJson<{
      current: { temperature_2m: number; precipitation: number; weather_code: number };
      hourly: { time: string[]; precipitation_probability: number[] };
    }>(f, `${OPEN_METEO}?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code&hourly=precipitation_probability&forecast_hours=4&timezone=UTC`),
  );
  let rainInMinutes: number | null = null;
  let chance = 0;
  r.hourly.time.forEach((t, i) => {
    const p = r.hourly.precipitation_probability[i] ?? 0;
    const mins = Math.round((Date.parse(`${t}:00Z`) - now.getTime()) / 60_000);
    if (mins < -60 || mins > 180) return;
    chance = Math.max(chance, p);
    if (p >= 60 && rainInMinutes === null) rainInMinutes = Math.max(0, mins);
  });
  return {
    tempC: Math.round(r.current.temperature_2m),
    condition: WMO[r.current.weather_code] ?? 'unknown',
    rainingNow: r.current.precipitation > 0.1,
    rainChanceNext3h: chance,
    rainInMinutes,
  };
}
