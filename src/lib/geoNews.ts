import type { NewsHeadlinePayload } from "@/lib/macroData";

/*
 * Headline geolocation: infer where a story "lives" from its text, falling
 * back to the publishing desk's home market. Keyword rules are ordered -
 * the first match wins, so more specific entities come before broad regions.
 * Coordinates are financial-center anchors, not precise datelines: the globe
 * shows where the macro story points, and stacked stories at one anchor are
 * jittered into a local cluster.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
  place: string;
}

const RULES: Array<[RegExp, GeoPoint]> = [
  // US policy + markets
  [/\b(fed|fomc|powell|federal reserve|treasury dept|yellen|white house|washington|congress|senate)\b/i, { lat: 38.9, lon: -77.04, place: "Washington DC" }],
  [/\b(wall street|nyse|s&p|nasdaq|dow|equit(y|ies)|comex|gold|silver)\b/i, { lat: 40.71, lon: -74.01, place: "New York" }],
  [/\b(wti|shale|permian|houston|crude inventories)\b/i, { lat: 29.76, lon: -95.37, place: "Houston" }],
  [/\b(us|u\.s\.|america|american|dollar|cpi|payrolls|jobless)\b/i, { lat: 40.71, lon: -74.01, place: "New York" }],
  // Europe
  [/\b(ecb|lagarde|eurozone|euro area|frankfurt|bund)\b/i, { lat: 50.11, lon: 8.68, place: "Frankfurt" }],
  [/\b(boe|bank of england|uk|britain|british|london|gilt|sterling|ftse)\b/i, { lat: 51.51, lon: -0.13, place: "London" }],
  [/\b(germany|german|berlin)\b/i, { lat: 52.52, lon: 13.4, place: "Berlin" }],
  [/\b(france|french|paris)\b/i, { lat: 48.86, lon: 2.35, place: "Paris" }],
  [/\b(italy|italian|rome)\b/i, { lat: 41.9, lon: 12.5, place: "Rome" }],
  [/\b(spain|spanish|madrid)\b/i, { lat: 40.42, lon: -3.7, place: "Madrid" }],
  [/\b(switzerland|swiss|snb|zurich|davos)\b/i, { lat: 47.37, lon: 8.54, place: "Zurich" }],
  [/\b(europe|european|eu\b|brussels)\b/i, { lat: 50.85, lon: 4.35, place: "Brussels" }],
  // Asia-Pacific
  [/\b(boj|bank of japan|japan|japanese|yen|tokyo|nikkei|ueda)\b/i, { lat: 35.68, lon: 139.69, place: "Tokyo" }],
  [/\b(china|chinese|pboc|beijing|yuan|renminbi|shanghai|hang seng|hong kong)\b/i, { lat: 39.9, lon: 116.41, place: "Beijing" }],
  [/\b(taiwan|taipei|tsmc)\b/i, { lat: 25.03, lon: 121.57, place: "Taipei" }],
  [/\b(korea|korean|seoul|kospi)\b/i, { lat: 37.57, lon: 126.98, place: "Seoul" }],
  [/\b(india|indian|rbi|mumbai|rupee|sensex)\b/i, { lat: 19.08, lon: 72.88, place: "Mumbai" }],
  [/\b(australia|australian|rba|sydney|aussie)\b/i, { lat: -33.87, lon: 151.21, place: "Sydney" }],
  [/\b(singapore|mas\b)\b/i, { lat: 1.35, lon: 103.82, place: "Singapore" }],
  // Middle East + energy
  [/\b(opec|saudi|riyadh|aramco)\b/i, { lat: 24.71, lon: 46.68, place: "Riyadh" }],
  [/\b(iran|tehran)\b/i, { lat: 35.69, lon: 51.39, place: "Tehran" }],
  [/\b(israel|gaza|tel aviv|jerusalem)\b/i, { lat: 32.09, lon: 34.78, place: "Tel Aviv" }],
  [/\b(uae|dubai|abu dhabi|qatar|doha)\b/i, { lat: 25.2, lon: 55.27, place: "Dubai" }],
  [/\b(middle east|red sea|strait of hormuz|houthis?)\b/i, { lat: 26.5, lon: 50.0, place: "Persian Gulf" }],
  [/\b(brent|oil|opec\+|barrel)\b/i, { lat: 24.71, lon: 46.68, place: "Riyadh" }],
  // Rest of world
  [/\b(russia|russian|moscow|kremlin|ruble|putin)\b/i, { lat: 55.76, lon: 37.62, place: "Moscow" }],
  [/\b(ukraine|ukrainian|kyiv|kiev)\b/i, { lat: 50.45, lon: 30.52, place: "Kyiv" }],
  [/\b(turkey|turkish|ankara|lira|istanbul)\b/i, { lat: 41.01, lon: 28.98, place: "Istanbul" }],
  [/\b(canada|canadian|boc|ottawa|loonie|toronto)\b/i, { lat: 43.65, lon: -79.38, place: "Toronto" }],
  [/\b(mexico|mexican|peso|banxico)\b/i, { lat: 19.43, lon: -99.13, place: "Mexico City" }],
  [/\b(brazil|brazilian|real\b|brasilia|sao paulo)\b/i, { lat: -23.55, lon: -46.63, place: "São Paulo" }],
  [/\b(argentina|buenos aires)\b/i, { lat: -34.6, lon: -58.38, place: "Buenos Aires" }],
  [/\b(south africa|johannesburg|rand)\b/i, { lat: -26.2, lon: 28.05, place: "Johannesburg" }],
  [/\b(nigeria|lagos)\b/i, { lat: 6.52, lon: 3.38, place: "Lagos" }],
  [/\b(egypt|cairo|suez)\b/i, { lat: 30.04, lon: 31.24, place: "Cairo" }],
];

/** Publishing-desk fallback when the text names no place. */
const SOURCE_HOME: Array<[RegExp, GeoPoint]> = [
  [/fed|federal reserve/i, { lat: 38.9, lon: -77.04, place: "Washington DC" }],
  [/fxstreet/i, { lat: 41.39, lon: 2.17, place: "Barcelona" }],
  [/reuters|ft|financial times|bbc/i, { lat: 51.51, lon: -0.13, place: "London" }],
  [/cnbc|wsj|wall street|yahoo|bloomberg|marketwatch/i, { lat: 40.71, lon: -74.01, place: "New York" }],
];

const DEFAULT_HOME: GeoPoint = { lat: 40.71, lon: -74.01, place: "New York" };

/** Deterministic per-index hash in [-1, 1). */
function hash(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export function locateHeadline(h: NewsHeadlinePayload, index: number): GeoPoint {
  const text = `${h.title} ${h.description ?? ""}`;
  let anchor: GeoPoint | null = null;
  for (const [re, pt] of RULES) {
    if (re.test(text)) {
      anchor = pt;
      break;
    }
  }
  if (!anchor) {
    for (const [re, pt] of SOURCE_HOME) {
      if (re.test(h.source)) {
        anchor = pt;
        break;
      }
    }
  }
  if (!anchor) anchor = DEFAULT_HOME;

  // Spread co-located stories into a small cluster around the anchor.
  return {
    lat: Math.max(-85, Math.min(85, anchor.lat + hash(index, 1) * 7)),
    lon: anchor.lon + hash(index, 2) * 7,
    place: anchor.place,
  };
}
