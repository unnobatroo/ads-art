/**
 * SERVICE WORKER
 * Manages caching and serves artwork to content scripts.
 * Fetches from: Art Institute of Chicago, The Metropolitan Museum, NASA
 */

// ===== API Configuration =====

const APIS = {
  ARTIC: 'https://api.artic.edu/api/v1',
  MET: 'https://collectionapi.metmuseum.org/public/collection/v1',
  NASA: 'https://images-api.nasa.gov',
};

// API query configurations by category
const QUERIES = {
  artic: { all: 'painting', art: 'painting' },
  met: { all: 'painting', art: 'painting' },
  nasa: [
    'nebula hubble', 'galaxy hubble', 'pillars of creation',
    'earth from space', 'aurora borealis ISS', 'saturn cassini',
    'jupiter juno', 'astronaut spacewalk EVA', 'hubble deep field',
    'carina nebula', 'orion nebula', 'andromeda galaxy',
    'solar eclipse', 'earthrise', 'blue marble',
  ],
};

// Which APIs to use per category
const CATEGORY_APIS = {
  all: ['artic', 'met', 'nasa'],
  art: ['artic', 'met'],
  nasa: ['nasa'],
};

// State
const tabCounts = new Map(); // Track replacements per tab
const shownIds = new Set(); // Track shown artworks to avoid repeats
let lastSource = ''; // Track last source for variety

// ===== Utility Functions =====

/**
 * Normalize category to valid value
 */
function normalizeCategory(category) {
  if (category === 'nasa') return 'nasa';
  if (category === 'all' || category === 'art') return category;
  return 'art';
}

/**
 * Classify aspect ratio into three buckets for caching
 */
function classifyAspect(width, height) {
  const ratio = width / height;
  if (ratio > 1.3) return 'landscape';
  if (ratio < 0.77) return 'portrait';
  return 'square';
}

/**
 * Score artwork based on aspect ratio and size fit
 */
function scoreArtwork(artwork, targetRatio, targetWidth, targetHeight) {
  if (!artwork.width || !artwork.height) return 999; // No dimensions, low priority

  const artRatio = artwork.width / artwork.height;
  const ratioDiff = Math.abs(artRatio - targetRatio);

  // Ratio is most important
  let score = ratioDiff * 0.8;

  // Size penalty for very small or large artworks
  if (targetWidth > 0 && targetHeight > 0) {
    const artArea = artwork.width * artwork.height;
    const targetArea = targetWidth * targetHeight;

    // Penalize if too small or too large
    if (artArea < targetArea * 0.5 || artArea > targetArea * 3) {
      const sizePenalty = artArea < targetArea * 0.5
        ? (targetArea * 0.5 - artArea) / (targetArea * 0.5)
        : (artArea - targetArea * 3) / (targetArea * 3);
      score += Math.min(sizePenalty, 1) * 0.2;
    }
  }

  return score;
}

/**
 * Pick best matching artwork from candidates
 */
function pickBestArtwork(artworks, targetRatio, targetWidth, targetHeight) {
  const withDims = artworks.filter(a => a.width && a.height);
  if (withDims.length === 0) {
    return artworks[Math.floor(Math.random() * artworks.length)];
  }

  // Sort by score and return best
  const scored = withDims.map(art => ({
    art,
    score: scoreArtwork(art, targetRatio, targetWidth, targetHeight),
  }));

  scored.sort((a, b) => a.score - b.score);
  return scored[0].art;
}

// ===== API Fetchers =====

/**
 * Fetch artworks from Art Institute of Chicago
 */
async function fetchArtIC(category) {
  const query = QUERIES.artic[normalizeCategory(category)];
  const page = Math.floor(Math.random() * 200) + 1;

  try {
    const url = new URL(`${APIS.ARTIC}/artworks/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('fields', 'id,title,artist_display,date_display,image_id,thumbnail');
    url.searchParams.set('limit', '40');
    url.searchParams.set('page', String(page));

    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    return (data.data || [])
      .filter(item => item.image_id)
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
    console.warn('[Art Replacer] AIC fetch error:', e);
    return [];
  }
}

/**
 * Fetch artworks from The Metropolitan Museum of Art
 */
async function fetchMetMuseum(category, count = 20) {
  const query = QUERIES.met[normalizeCategory(category)];

  try {
    const searchUrl = new URL(`${APIS.MET}/search`);
    searchUrl.searchParams.set('hasImages', 'true');
    searchUrl.searchParams.set('q', query);

    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return [];

    const searchData = await searchRes.json();
    const objectIDs = searchData.objectIDs || [];
    if (objectIDs.length === 0) return [];

    // Shuffle and select random objects
    const shuffled = [...objectIDs].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, count);

    // Fetch details for each object
    const objects = await Promise.all(
      selected.map(id =>
        fetch(`${APIS.MET}/objects/${id}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    );

    return objects
      .filter(obj => obj && (obj.primaryImage || obj.primaryImageSmall))
      .map(obj => ({
        id: `met:${obj.objectID}`,
        title: obj.title || 'Untitled',
        artist: obj.artistDisplayName || 'Unknown Artist',
        date: obj.objectDate || '',
        source: 'The Metropolitan Museum of Art',
        imageId: null,
        imageUrl: obj.primaryImage,
        smallImageUrl: obj.primaryImageSmall,
        width: 0,
        height: 0,
      }));
  } catch (e) {
    console.warn('[Art Replacer] Met fetch error:', e);
    return [];
  }
}

/**
 * Fetch artworks from NASA
 */
async function fetchNASA(count = 40) {
  const query = QUERIES.nasa[Math.floor(Math.random() * QUERIES.nasa.length)];
  const page = Math.floor(Math.random() * 50) + 1;

  try {
    const url = new URL(`${APIS.NASA}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('media_type', 'image');
    url.searchParams.set('page_size', String(count));
    url.searchParams.set('page', String(page));

    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();

    // Filter out non-image content
    const JUNK_KEYWORDS = [
      'chart', 'graph', 'diagram', 'map', 'temperature', 'data',
      'plot', 'spectrum', 'schematic', 'logo', 'headshot', 'group photo',
    ];

    return (data.collection?.items || [])
      .filter(item => {
        if (!item.links?.length || !item.links[0].href) return false;
        const title = (item.data?.[0]?.title || '').toLowerCase();
        if (JUNK_KEYWORDS.some(kw => title.includes(kw))) return false;
        const href = item.links[0].href;
        return !href.endsWith('.gif');
      })
      .map(item => {
        const meta = item.data?.[0] || {};
        const thumbUrl = item.links[0].href;
        const fullUrl = thumbUrl.replace('~thumb', '~medium').replace('~small', '~medium');

        return {
          id: `nasa:${meta.nasa_id || Math.random().toString(36).slice(2)}`,
          title: meta.title || 'NASA Image',
          artist: meta.photographer || meta.secondary_creator || 'NASA',
          date: meta.date_created ? meta.date_created.split('T')[0] : '',
          source: 'NASA',
          imageId: null,
          imageUrl: fullUrl,
          smallImageUrl: thumbUrl,
          width: 1600,
          height: 1200,
        };
      });
  } catch (e) {
    console.warn('[Art Replacer] NASA fetch error:', e);
    return [];
  }
}

// ===== Caching =====

/**
 * Interleave arrays to mix sources
 */
function interleaveArrays(arrays) {
  const result = [];
  const maxLen = Math.max(...arrays.map(a => a.length));

  for (let i = 0; i < maxLen; i++) {
    for (const arr of arrays) {
      if (i < arr.length) result.push(arr[i]);
    }
  }

  return result;
}

/**
 * Store artworks in cache by aspect ratio bucket
 */
async function storeArtworksInCache(artworks, category) {
  if (!artworks?.length) return;

  const buckets = { landscape: [], portrait: [], square: [] };

  // Distribute artworks into buckets
  for (const art of artworks) {
    if (shownIds.has(art.id)) continue;

    const entry = { ...art, cachedAt: Date.now() };

    if (art.width && art.height) {
      const aspect = classifyAspect(art.width, art.height);
      buckets[aspect].push(entry);
    } else {
      // Unknown dimensions, add to all buckets
      buckets.landscape.push(entry);
      buckets.portrait.push(entry);
      buckets.square.push(entry);
    }
  }

  // Save to Chrome storage
  for (const [aspect, entries] of Object.entries(buckets)) {
    if (entries.length === 0) continue;

    const key = `cache:${category}:${aspect}`;
    const existing = (await chrome.storage.local.get(key))[key] || [];
    const seen = new Set(existing.map(e => e.id));
    const merged = [...existing, ...entries.filter(e => !seen.has(e.id))];
    const capped = merged.slice(-300); // Keep only last 300

    await chrome.storage.local.set({ [key]: capped });
  }
}

/**
 * Fetch artworks from all enabled APIs and cache them
 */
async function fetchAndCache(category) {
  category = normalizeCategory(category);
  const apis = CATEGORY_APIS[category] || CATEGORY_APIS.all;

  // Fetch from all enabled APIs in parallel
  const results = await Promise.all([
    apis.includes('artic') ? fetchArtIC(category) : Promise.resolve([]),
    apis.includes('met') ? fetchMetMuseum(category, 20) : Promise.resolve([]),
    apis.includes('nasa') ? fetchNASA(40) : Promise.resolve([]),
  ]);

  const allArtworks = interleaveArrays(results);
  if (allArtworks.length > 0) {
    await storeArtworksInCache(allArtworks, category);
  }

  return allArtworks;
}

/**
 * Pop one artwork from cache that matches the requested aspect
 */
async function getArtworkFromCache(aspect, category, targetRatio, targetWidth, targetHeight) {
  // Try buckets in order: exact aspect, then other aspects
  const bucketOrder = [aspect];
  if (aspect !== 'square') bucketOrder.push('square');
  if (aspect === 'landscape') bucketOrder.push('portrait');
  if (aspect === 'portrait') bucketOrder.push('landscape');

  for (const bucket of bucketOrder) {
    const key = `cache:${category}:${bucket}`;
    const result = await chrome.storage.local.get(key);
    const items = result[key];
    if (!items?.length) continue;

    // Filter valid items (not expired, not shown)
    const now = Date.now();
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const valid = items.filter(item =>
      now - item.cachedAt < WEEK && !shownIds.has(item.id)
    );
    if (!valid.length) continue;

    // Prefer different source than last time
    const fromOtherSource = valid.filter(item => item.source !== lastSource);
    const candidates = fromOtherSource.length > 0 ? fromOtherSource : valid;

    // Pick best match
    const artwork = pickBestArtwork(candidates, targetRatio, targetWidth, targetHeight);
    if (!artwork) continue;

    // Mark as used and update cache
    shownIds.add(artwork.id);
    lastSource = artwork.source;

    const remaining = items.filter(item => item.id !== artwork.id);
    await chrome.storage.local.set({ [key]: remaining });

    // Refill if cache getting low
    if (remaining.length < 10) {
      fetchAndCache(category).catch(() => {});
    }

    return artwork;
  }

  return null;
}

// ===== Message Handlers =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_ART') {
    handleGetArt(message).then(sendResponse);
    return true;
  }

  if (message.type === 'INCREMENT_COUNT') {
    const tabId = sender.tab?.id;
    if (tabId) {
      const count = (tabCounts.get(tabId) || 0) + 1;
      tabCounts.set(tabId, count);
      chrome.action.setBadgeBackgroundColor({ color: '#d9cfc6', tabId });

      // Update session counter
      chrome.storage.session.get({ totalReplaced: 0 }).then(result => {
        chrome.storage.session.set({ totalReplaced: result.totalReplaced + 1 });
      });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'GET_COUNT') {
    chrome.storage.session.get({ totalReplaced: 0 }).then(sendResponse);
    return true;
  }

  return false;
});

/**
 * Handle art request from content script
 */
async function handleGetArt({ width, height, category }) {
  category = normalizeCategory(category);
  const aspect = classifyAspect(width, height);
  const ratio = width / height;

  // Try to get from cache
  let artwork = await getArtworkFromCache(aspect, category, ratio, width, height);

  // If cache miss, fetch new artworks
  if (!artwork) {
    await fetchAndCache(category);
    artwork = await getArtworkFromCache(aspect, category, ratio, width, height);
  }

  return artwork ? { artwork } : null;
}

// ===== Lifecycle =====

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Art Replacer] Extension installed, pre-caching artworks...');

  // Pre-cache from multiple sources
  await Promise.all([
    fetchAndCache('all'),
    fetchAndCache('all'),
    fetchAndCache('art'),
    fetchAndCache('nasa'),
  ]);

  console.log('[Art Replacer] Pre-cache complete');
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCounts.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabCounts.set(tabId, 0);
    chrome.action.setBadgeText({ text: '', tabId });
  }
});
