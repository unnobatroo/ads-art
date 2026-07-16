// Fetches artwork from museum APIs (AIC, the Met), caches it by aspect ratio,
// and serves a best-fit piece to the content script on request.

const ARTIC_API = 'https://api.artic.edu/api/v1';
const MET_API = 'https://collectionapi.metmuseum.org/public/collection/v1';
const QUERY = 'painting';

const CACHE_MAX_ITEMS = 300;
const CACHE_REFILL_THRESHOLD = 10;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SHOWN_IDS = 2000;

const ASPECTS: ArtworkAspect[] = ['landscape', 'portrait', 'square'];
const shownIds = new Set<string>();
const shownIdQueue: string[] = [];
let fetchInFlight: Promise<Artwork[]> | null = null;
let lastSource = '';

// Sort an aspect ratio into one of three cache lanes.
function classifyAspect(width: number, height: number): ArtworkAspect {
  if (!width || !height) return 'square';
  const ratio = width / height;
  if (ratio > 1.3) return 'landscape';
  if (ratio < 0.77) return 'portrait';
  return 'square';
}

// Mark an artwork shown, evicting the oldest once the set is full.
function markArtworkShown(id: string): void {
  if (!id || shownIds.has(id)) return;
  shownIds.add(id);
  shownIdQueue.push(id);
  while (shownIdQueue.length > MAX_SHOWN_IDS) {
    const oldestId = shownIdQueue.shift();
    if (oldestId) shownIds.delete(oldestId);
  }
}

// Lower score = better fit. Aspect ratio dominates; low resolution is penalized.
function scoreArtwork(
  art: Artwork,
  targetRatio: number,
  targetWidth: number,
  targetHeight: number
): number {
  if (!art.width || !art.height) return 999;

  let score = Math.abs(art.width / art.height - targetRatio) * 0.8;

  if (targetWidth > 0 && targetHeight > 0) {
    const artArea = art.width * art.height;
    const targetArea = targetWidth * targetHeight;
    if (artArea < targetArea * 0.5) {
      score += Math.min((targetArea * 0.5 - artArea) / (targetArea * 0.5), 1) * 0.2;
    }
  }
  return score;
}

function pickBestArtwork(
  artworks: Artwork[],
  targetRatio: number,
  targetWidth: number,
  targetHeight: number
): Artwork | undefined {
  let best: Artwork | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const artwork of artworks) {
    if (!artwork.width || !artwork.height) continue;
    const score = scoreArtwork(artwork, targetRatio, targetWidth, targetHeight);
    if (score < bestScore) {
      best = artwork;
      bestScore = score;
    }
  }

  if (best) return best;
  return artworks[Math.floor(Math.random() * artworks.length)];
}

function sample<T>(items: T[], count: number): T[] {
  const size = Math.min(count, items.length);
  const result = items.slice(0, size);

  for (let index = size; index < items.length; index++) {
    const replacementIndex = Math.floor(Math.random() * (index + 1));
    const item = items[index];
    if (replacementIndex < size && item !== undefined) {
      result[replacementIndex] = item;
    }
  }

  return result;
}

interface ArtICSearchItem {
  id: number;
  title?: string;
  artist_display?: string;
  date_display?: string;
  image_id?: string;
  thumbnail?: {
    width?: number;
    height?: number;
  };
}

interface ArtICSearchResponse {
  data?: ArtICSearchItem[];
}

interface MetSearchResponse {
  objectIDs?: number[];
}

interface MetObject {
  objectID: number;
  title?: string;
  artistDisplayName?: string;
  objectDate?: string;
  primaryImage?: string;
  primaryImageSmall?: string;
}

async function fetchArtIC(): Promise<Artwork[]> {
  try {
    const url = new URL(`${ARTIC_API}/artworks/search`);
    url.searchParams.set('q', QUERY);
    url.searchParams.set('fields', 'id,title,artist_display,date_display,image_id,thumbnail');
    url.searchParams.set('limit', '40');
    url.searchParams.set('page', String(Math.floor(Math.random() * 200) + 1));

    const res = await fetch(url);
    if (!res.ok) return [];

    const { data = [] } = await res.json() as ArtICSearchResponse;
    return data
      .filter((item): item is ArtICSearchItem & { image_id: string } => Boolean(item.image_id))
      .map(item => ({
        id: `artic:${item.id}`,
        title: item.title || 'Untitled',
        artist: item.artist_display || 'Unknown Artist',
        date: item.date_display || '',
        source: 'Art Institute of Chicago',
        imageId: item.image_id,
        imageUrl: null,
        smallImageUrl: null,
        width: item.thumbnail?.width || 0,
        height: item.thumbnail?.height || 0,
      }));
  } catch (e) {
    console.warn('[Ads Art] AIC fetch error:', e);
    return [];
  }
}

async function fetchMetMuseum(count = 20): Promise<Artwork[]> {
  try {
    const searchUrl = new URL(`${MET_API}/search`);
    searchUrl.searchParams.set('hasImages', 'true');
    searchUrl.searchParams.set('q', QUERY);

    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return [];

    const { objectIDs = [] } = await searchRes.json() as MetSearchResponse;
    if (objectIDs.length === 0) return [];

    const selected = sample(objectIDs, count);
    const objects = await Promise.all(
      selected.map(id =>
        fetch(`${MET_API}/objects/${id}`)
          .then(async (response): Promise<MetObject | null> =>
            response.ok ? await response.json() as MetObject : null
          )
          .catch(() => null)
      )
    );

    return objects
      .filter((obj): obj is MetObject => Boolean(obj && (obj.primaryImage || obj.primaryImageSmall)))
      .map(obj => ({
        id: `met:${obj.objectID}`,
        title: obj.title || 'Untitled',
        artist: obj.artistDisplayName || 'Unknown Artist',
        date: obj.objectDate || '',
        source: 'The Metropolitan Museum of Art',
        imageId: null,
        imageUrl: obj.primaryImage ?? null,
        smallImageUrl: obj.primaryImageSmall ?? null,
        width: 0,
        height: 0,
      }));
  } catch (e) {
    console.warn('[Ads Art] Met fetch error:', e);
    return [];
  }
}

const cacheKey = (aspect: ArtworkAspect): string => `cache:${aspect}`;

async function getCachedArtworks(key: string): Promise<CachedArtwork[]> {
  const stored = await chrome.storage.local.get(key);
  const value: unknown = stored[key];
  return Array.isArray(value) ? value as CachedArtwork[] : [];
}

// Store new artworks into their aspect-ratio lanes (unknown dims go in all).
async function storeArtworks(artworks: Artwork[]): Promise<void> {
  if (artworks.length === 0) return;

  const buckets: Record<ArtworkAspect, CachedArtwork[]> = {
    landscape: [],
    portrait: [],
    square: [],
  };
  for (const art of artworks) {
    if (shownIds.has(art.id)) continue;
    const entry = { ...art, cachedAt: Date.now() };
    if (art.width && art.height) {
      buckets[classifyAspect(art.width, art.height)].push(entry);
    } else {
      buckets.landscape.push(entry);
      buckets.portrait.push(entry);
      buckets.square.push(entry);
    }
  }

  for (const [aspect, entries] of Object.entries(buckets) as [ArtworkAspect, CachedArtwork[]][]) {
    if (entries.length === 0) continue;
    const key = cacheKey(aspect);
    const existing = await getCachedArtworks(key);
    const seen = new Set(existing.map(e => e.id));
    const merged = [...existing, ...entries.filter(e => !seen.has(e.id))];
    await chrome.storage.local.set({ [key]: merged.slice(-CACHE_MAX_ITEMS) });
  }
}

// Fetch from all sources and cache them; concurrent calls share one request.
function fetchAndCache(): Promise<Artwork[]> {
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async () => {
    const [artic, met] = await Promise.all([fetchArtIC(), fetchMetMuseum()]);
    const artworks = [...artic, ...met];
    if (artworks.length > 0) await storeArtworks(artworks);
    return artworks;
  })().finally(() => { fetchInFlight = null; });

  return fetchInFlight;
}

// Take one best-fit, unseen artwork from the cache, preferring `aspect`.
async function takeFromCache(
  aspect: ArtworkAspect,
  targetRatio: number,
  targetWidth: number,
  targetHeight: number
): Promise<Artwork | null> {
  // Matching lane first, then the others.
  const lanes = [aspect, ...ASPECTS.filter(lane => lane !== aspect)];

  for (const lane of lanes) {
    const key = cacheKey(lane);
    const items = await getCachedArtworks(key);
    if (items.length === 0) continue;

    const now = Date.now();
    const valid = items.filter(item =>
      now - item.cachedAt < CACHE_MAX_AGE_MS && !shownIds.has(item.id)
    );

    if (!valid.length) {
      // Nothing usable here — persist the pruning if anything was dropped.
      if (valid.length !== items.length) await chrome.storage.local.set({ [key]: valid });
      continue;
    }

    // Prefer a different source than last time for variety.
    const fromOtherSource = valid.filter(item => item.source !== lastSource);
    const candidates = fromOtherSource.length > 0 ? fromOtherSource : valid;

    const artwork = pickBestArtwork(candidates, targetRatio, targetWidth, targetHeight);
    if (!artwork) continue;

    markArtworkShown(artwork.id);
    lastSource = artwork.source;

    // Persist the lane minus stale entries and the one we just used.
    const remaining = valid.filter(item => item.id !== artwork.id);
    await chrome.storage.local.set({ [key]: remaining });

    if (remaining.length < CACHE_REFILL_THRESHOLD) {
      fetchAndCache().catch((error) => {
        console.warn('[Ads Art] Cache refill failed:', error);
      });
    }
    return artwork;
  }

  return null;
}

async function handleGetArt({ width, height }: GetArtMessage): Promise<GetArtResponse> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { artwork: null };
  }

  const aspect = classifyAspect(width, height);
  const ratio = width / height;

  // Serve from cache; on a miss, fetch once and try again.
  let artwork = await takeFromCache(aspect, ratio, width, height);
  if (!artwork) {
    await fetchAndCache();
    artwork = await takeFromCache(aspect, ratio, width, height);
  }
  return { artwork: artwork || null };
}

function isGetArtMessage(message: unknown): message is GetArtMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Partial<GetArtMessage>;
  return candidate.type === 'GET_ART'
    && typeof candidate.width === 'number'
    && typeof candidate.height === 'number';
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isGetArtMessage(message)) return false;

  handleGetArt(message)
    .then(sendResponse)
    .catch((error) => {
      console.warn('[Ads Art] Message handling error:', error);
      sendResponse({ artwork: null });
    });

  return true; // response is async
});

// Warm the cache on install so the first ad has art ready.
chrome.runtime.onInstalled.addListener(() => {
  fetchAndCache().catch((error) => {
    console.warn('[Ads Art] Pre-cache error:', error);
  });
});
