const ARTIC_BASE = 'https://api.artic.edu/api/v1';
const MET_BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';
const NASA_BASE = 'https://images-api.nasa.gov';

function normalizeCategory(category) {
  if (category === 'nasa') return 'nasa';
  if (category === 'all' || category === 'art') return category;
  return 'art';
}

const CATEGORY_CONFIG = {
  all: { apis: ['artic', 'met', 'nasa'] },
  art: { apis: ['artic', 'met'] },
  nasa: { apis: ['nasa'] },
};

const ARTIC_CATEGORY_QUERIES = {
  all: { q: 'painting' },
  art: { q: 'painting' },
};

const MET_CATEGORY_QUERIES = {
  all: 'painting',
  art: 'painting',
};

const NASA_QUERIES = [
  'nebula hubble', 'galaxy hubble', 'pillars of creation',
  'earth from space', 'aurora borealis ISS', 'saturn cassini',
  'jupiter juno', 'astronaut spacewalk EVA', 'hubble deep field',
  'carina nebula', 'orion nebula', 'andromeda galaxy',
  'solar eclipse', 'earthrise', 'blue marble',
  'eagle nebula', 'helix nebula', 'sombrero galaxy',
  'supernova remnant', 'star forming region',
];

const tabCounts = new Map();
const shownIds = new Set();
let lastSource = '';

async function fetchArticArtworks(category = 'all') {
  const catConfig = ARTIC_CATEGORY_QUERIES[category] || ARTIC_CATEGORY_QUERIES.all;
  const randomPage = Math.floor(Math.random() * 200) + 1;

  const params = new URLSearchParams({
    q: catConfig.q,
    fields: 'id,title,artist_display,date_display,image_id,thumbnail',
    limit: '40',
    page: String(randomPage),
  });
  try {
    const res = await fetch(`${ARTIC_BASE}/artworks/search?${params}`);
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
    console.warn('[Art Replacer SW] AIC fetch error:', e);
    return [];
  }
}

async function fetchMetArtworks(category = 'all', count = 20) {
  const query = MET_CATEGORY_QUERIES[category] || MET_CATEGORY_QUERIES.all;

  try {
    const searchRes = await fetch(`${MET_BASE}/search?hasImages=true&q=${encodeURIComponent(query)}`);
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();

    const objectIDs = searchData.objectIDs;
    if (!objectIDs || objectIDs.length === 0) return [];

    const shuffled = [...objectIDs].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, count);

    const objects = await Promise.all(
      selected.map(async (id) => {
        try {
          const res = await fetch(`${MET_BASE}/objects/${id}`);
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      })
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
    console.warn('[Art Replacer SW] Met fetch error:', e);
    return [];
  }
}

async function fetchNasaArtworks(count = 40) {
  const query = NASA_QUERIES[Math.floor(Math.random() * NASA_QUERIES.length)];
  const randomPage = Math.floor(Math.random() * 50) + 1;

  try {
    const params = new URLSearchParams({
      q: query,
      media_type: 'image',
      page_size: String(count),
      page: String(randomPage),
    });

    const res = await fetch(`${NASA_BASE}/search?${params}`);
    if (!res.ok) return [];
    const data = await res.json();

    const JUNK_KEYWORDS = [
      'chart', 'graph', 'diagram', 'map', 'temperature', 'data',
      'plot', 'spectrum', 'schematic', 'logo', 'insignia', 'badge',
      'patch', 'portrait photo of', 'headshot', 'group photo',
      'press conference', 'signing', 'ceremony', 'meeting',
    ];

    return (data.collection?.items || [])
      .filter(item => {
        if (!item.links?.length || !item.links[0].href) return false;
        const title = (item.data?.[0]?.title || '').toLowerCase();
        const desc = (item.data?.[0]?.description || '').toLowerCase();
        if (JUNK_KEYWORDS.some(kw => title.includes(kw))) return false;
        const href = item.links[0].href;
        if (href.endsWith('.gif')) return false;
        return true;
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
    console.warn('[Art Replacer SW] NASA fetch error:', e);
    return [];
  }
}

function classifyAspect(width, height) {
  const ratio = width / height;
  if (ratio > 1.3) return 'landscape';
  if (ratio < 0.77) return 'portrait';
  return 'square';
}

/** store new artworks by size bucket. */
async function storeInCache(artworks, category) {
  if (!artworks || artworks.length === 0) return;

  const buckets = { landscape: [], portrait: [], square: [] };

  for (const art of artworks) {
    if (shownIds.has(art.id)) continue;

    let aspect = 'square';
    if (art.width && art.height) {
      aspect = classifyAspect(art.width, art.height);
    }

    const entry = { ...art, cachedAt: Date.now() };
    buckets[aspect].push(entry);

    if (!art.width || !art.height) {
      buckets.landscape.push({ ...entry });
      buckets.portrait.push({ ...entry });
    }
  }

  for (const [aspect, entries] of Object.entries(buckets)) {
    if (entries.length === 0) continue;
    const key = `cache:${category}:${aspect}`;
    const existing = (await chrome.storage.local.get(key))[key] || [];
    const ids = new Set(existing.map(e => e.id));
    const merged = [...existing, ...entries.filter(e => !ids.has(e.id))];
    const capped = merged.slice(-300);
    await chrome.storage.local.set({ [key]: capped });
  }
}

async function fetchAndCache(category) {
  category = normalizeCategory(category);
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.all;
  const apis = config.apis;

  const fetchers = apis.map(api => {
    switch (api) {
      case 'artic': return fetchArticArtworks(category).catch(() => []);
      case 'met': return fetchMetArtworks(category, 20).catch(() => []);
      case 'nasa': return fetchNasaArtworks(40).catch(() => []);
      default: return Promise.resolve([]);
    }
  });

  const results = await Promise.all(fetchers);

  const allArtworks = interleave(results);

  if (allArtworks.length > 0) {
    await storeInCache(allArtworks, category);
  }

  return allArtworks;
}

function interleave(arrays) {
  const result = [];
  const maxLen = Math.max(...arrays.map(a => a.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of arrays) {
      if (i < arr.length) result.push(arr[i]);
    }
  }
  return result;
}

/** pop one artwork from cache. */
async function popFromCache(aspectClass, category, targetRatio) {
  const bucketOrder = [aspectClass];
  if (aspectClass !== 'square') bucketOrder.push('square');
  if (aspectClass === 'landscape') bucketOrder.push('portrait');
  if (aspectClass === 'portrait') bucketOrder.push('landscape');

  for (const bucket of bucketOrder) {
    const key = `cache:${category}:${bucket}`;
    const result = await chrome.storage.local.get(key);
    const items = result[key];
    if (!items || items.length === 0) continue;

    const now = Date.now();
    const valid = items.filter(item =>
      now - item.cachedAt < 7 * 24 * 60 * 60 * 1000 &&
      !shownIds.has(item.id)
    );
    if (valid.length === 0) continue;

    const fromOtherSource = valid.filter(item => item.source !== lastSource);
    const candidates = fromOtherSource.length > 0 ? fromOtherSource : valid;

    const pick = pickBestMatch(candidates, targetRatio);
    if (!pick) continue;

    const remaining = items.filter(item => item.id !== pick.id);
    await chrome.storage.local.set({ [key]: remaining });

    shownIds.add(pick.id);
    lastSource = pick.source;

    if (remaining.length < 10) {
      fetchAndCache(category).catch(() => { });
    }

    return pick;
  }
  return null;
}

function pickBestMatch(artworks, targetRatio) {
  const withDims = artworks.filter(a => a.width && a.height);
  if (withDims.length > 0) {
    withDims.sort((a, b) =>
      Math.abs((a.width / a.height) - targetRatio) -
      Math.abs((b.width / b.height) - targetRatio)
    );
    const top = withDims.slice(0, Math.min(5, withDims.length));
    return top[Math.floor(Math.random() * top.length)];
  }
  return artworks[Math.floor(Math.random() * artworks.length)];
}

// --- Message handling ---

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
      chrome.action.setBadgeText({ text: String(count), tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#6B4C9A', tabId });

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

  if (message.type === 'REFILL_CACHE') {
    fetchAndCache(message.category).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function handleGetArt({ width, height, category }) {
  category = normalizeCategory(category);
  const aspectClass = classifyAspect(width, height);
  const targetRatio = width / height;

  let artwork = await popFromCache(aspectClass, category, targetRatio);

  if (!artwork) {
    await fetchAndCache(category);
    artwork = await popFromCache(aspectClass, category, targetRatio);
  }

  return artwork ? { artwork } : null;
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Art Replacer] installed, prefetching art');
  await Promise.all([
    fetchAndCache('all'),
    fetchAndCache('all'),
    fetchAndCache('all'),
    fetchAndCache('all'),
  ]);
  console.log('[Art Replacer] prefetch complete');
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
