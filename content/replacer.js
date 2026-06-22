// Swaps detected ad slots for museum artwork.

(async function () {
  const AR = window.__artReplacer;
  if (!AR) return;

  const settings = await chrome.storage.sync.get({ enabled: true });
  if (!settings.enabled) return;

  const MIN_DIMENSION = 50;
  const RATIO_TOLERANCE = 0.2;
  const DEBUG = false;
  let replaceQueue = Promise.resolve();

  // Open connections to the image hosts now so the first download skips
  // DNS + TLS setup.
  (function preconnectImageHosts() {
    const head = document.head || document.documentElement;
    if (!head) return;
    for (const host of ['https://www.artic.edu', 'https://images.metmuseum.org']) {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = host;
      link.crossOrigin = 'anonymous';
      head.appendChild(link);
    }
  })();

  function getDevicePixelRatio() {
    return Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  }

  // Snapping to standard IIIF widths lets the CDN reuse a cached derivative
  // instead of generating a fresh resize for every odd per-slot width.
  const IIIF_WIDTH_BUCKETS = [200, 400, 600, 843, 1200, 1686];

  function bucketWidth(width) {
    for (const bucket of IIIF_WIDTH_BUCKETS) {
      if (width <= bucket) return bucket;
    }
    return IIIF_WIDTH_BUCKETS[IIIF_WIDTH_BUCKETS.length - 1];
  }

  // Build the image URL for an artwork, cropping AIC pieces to the slot ratio.
  function buildArtImageUrl(artwork, slotWidth, slotHeight) {
    // The Met (no imageId) gives a small web image and a multi-MB original;
    // use the small one unless the slot is too large for it.
    if (!artwork.imageId) {
      const SMALL_IMAGE_LONG_EDGE = 600;
      const needsFull = Math.max(slotWidth, slotHeight) > SMALL_IMAGE_LONG_EDGE;
      if (needsFull && artwork.imageUrl) return artwork.imageUrl;
      return artwork.smallImageUrl || artwork.imageUrl || '';
    }

    // Scale for high-DPI, then snap to a cacheable width.
    const pixelRatio = getDevicePixelRatio();
    const reqWidth = bucketWidth(Math.min(Math.round(slotWidth * pixelRatio), 1600));

    // Unknown dims or close-enough ratio: serve the whole piece, uncropped.
    if (!artwork.width || !artwork.height) {
      return `https://www.artic.edu/iiif/2/${artwork.imageId}/full/${reqWidth},/0/default.jpg`;
    }

    const slotRatio = slotWidth / slotHeight;
    const artRatio = artwork.width / artwork.height;
    const ratioDiff = Math.abs(artRatio - slotRatio) / slotRatio;
    if (ratioDiff <= RATIO_TOLERANCE) {
      return `https://www.artic.edu/iiif/2/${artwork.imageId}/full/${reqWidth},/0/default.jpg`;
    }

    // Center-crop to the slot ratio: trim the longer axis, keep the shorter.
    let cropWidth, cropHeight, cropX, cropY;
    if (slotRatio > artRatio) {
      cropWidth = artwork.width;
      cropHeight = Math.round(artwork.width / slotRatio);
      cropX = 0;
      cropY = Math.round((artwork.height - cropHeight) / 2);
    } else {
      cropHeight = artwork.height;
      cropWidth = Math.round(artwork.height * slotRatio);
      cropX = Math.round((artwork.width - cropWidth) / 2);
      cropY = 0;
    }

    return `https://www.artic.edu/iiif/2/${artwork.imageId}/${cropX},${cropY},${cropWidth},${cropHeight}/${reqWidth},/0/default.jpg`;
  }

  // 'cover' for extreme ratios (would letterbox badly), 'contain' otherwise.
  function getObjectFit(slotWidth, slotHeight) {
    const ratio = slotWidth / slotHeight;
    return (ratio > 3 || ratio < 0.33) ? 'cover' : 'contain';
  }

  function makeLine(className, text) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    return el;
  }

  // Built with DOM APIs (never HTML strings) so untrusted artwork metadata
  // can't be interpreted as markup.
  function createArtContainer(artwork, slotWidth, slotHeight) {
    const container = document.createElement('div');
    container.className = 'art-replacer-container';
    container.style.cssText = `width:${slotWidth}px;height:${slotHeight}px;position:relative;overflow:hidden;`;

    const img = document.createElement('img');
    img.decoding = 'async';
    img.loading = 'eager';
    img.fetchPriority = 'high';
    img.src = buildArtImageUrl(artwork, slotWidth, slotHeight);
    img.alt = `${artwork.title} by ${artwork.artist}`;
    img.className = 'art-replacer-image';
    img.style.cssText = `width:100%;height:100%;object-fit:${getObjectFit(slotWidth, slotHeight)};`;
    container.appendChild(img);

    const tooltip = document.createElement('div');
    tooltip.className = 'art-replacer-tooltip';
    const dateStr = artwork.date ? ` (${artwork.date})` : '';
    tooltip.appendChild(makeLine('art-replacer-title', artwork.title));
    tooltip.appendChild(makeLine('art-replacer-meta', `${artwork.artist}${dateStr}`));
    tooltip.appendChild(makeLine('art-replacer-source', artwork.source));
    container.appendChild(tooltip);

    return container;
  }

  async function replaceAd(adElement) {
    if (adElement.dataset.artReplacer === 'replaced' || adElement.dataset.artReplacer === 'replacing') {
      return;
    }

    const rect = adElement.getBoundingClientRect();
    const width = Math.round(rect.width || adElement.offsetWidth || 0);
    const height = Math.round(rect.height || adElement.offsetHeight || 0);
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) return;

    adElement.dataset.artReplacer = 'replacing';

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ART', width, height });
      if (!response?.artwork) {
        adElement.dataset.artReplacer = 'failed';
        return;
      }

      const artwork = response.artwork;
      const artContainer = createArtContainer(artwork, width, height);

      // An iframe can't hold our markup, so swap it out in the parent.
      if (adElement.tagName === 'IFRAME') {
        const parent = adElement.parentElement;
        if (parent) {
          parent.insertBefore(artContainer, adElement);
          adElement.remove();
        } else {
          adElement.dataset.artReplacer = 'failed';
          return;
        }
      } else {
        adElement.replaceChildren(artContainer);
      }

      artContainer.dataset.artReplacer = 'replaced';

    } catch (error) {
      if (DEBUG) console.warn('[Art Replacer] Failed to replace ad:', error);
      adElement.dataset.artReplacer = 'failed';
    }
  }

  async function replaceAds(adElements) {
    for (const ad of adElements) {
      await replaceAd(ad);
    }
  }

  // Serialize replacements through one chain so they never overlap.
  function enqueueReplacement(adElements) {
    replaceQueue = replaceQueue
      .then(() => replaceAds(adElements))
      .catch((error) => {
        if (DEBUG) console.warn('[Art Replacer] Queue error:', error);
      });

    return replaceQueue;
  }

  // Existing ads on load.
  const initialAds = AR.detectAds(document);
  if (initialAds.length > 0) {
    if (DEBUG) console.log(`[Art Replacer] Found ${initialAds.length} ads on load`);
    await enqueueReplacement(initialAds);
  }

  // Ads injected later.
  if (AR.startObserver) {
    AR.startObserver(async (newAds) => {
      if (newAds.length > 0) {
        if (DEBUG) console.log(`[Art Replacer] Found ${newAds.length} new ads`);
        await enqueueReplacement(newAds);
      }
    });
  }

  // Re-run from scratch when the toggle changes so it applies immediately.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enabled) {
      location.reload();
    }
  });
})();
