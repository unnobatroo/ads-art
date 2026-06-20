/**
 * AD REPLACER
 * Replaces detected ads with artwork from various sources.
 */

(async function () {
  const AR = window.__artReplacer;
  if (!AR) return;

  // Get extension settings
  const settings = await chrome.storage.sync.get({ enabled: true });
  if (!settings.enabled) return;

  const MIN_DIMENSION = 50;
  const RATIO_TOLERANCE = 0.2;
  const DEBUG = false; // Set to true for logging
  let replaceQueue = Promise.resolve();

  function getDevicePixelRatio() {
    return Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  }

  /**
   * Build image URL for Art Institute of Chicago artwork
   * Crops if needed to match target aspect ratio
   */
  function buildArtImageUrl(artwork, slotWidth, slotHeight) {
    if (!artwork.imageId) {
      return artwork.imageUrl || artwork.smallImageUrl || '';
    }

    // Request higher resolution and account for high-DPI displays.
    const pixelRatio = getDevicePixelRatio();
    const reqWidth = Math.min(Math.round(slotWidth * pixelRatio), 1600);
    const reqHeight = Math.min(Math.round(slotHeight * pixelRatio), 1600);

    // If artwork dimensions unknown or ratios match, use full artwork
    if (!artwork.width || !artwork.height) {
      return `https://www.artic.edu/iiif/2/${artwork.imageId}/full/${reqWidth},/0/default.jpg`;
    }

    // Check if aspect ratios are too different
    const slotRatio = slotWidth / slotHeight;
    const artRatio = artwork.width / artwork.height;
    const ratioDiff = Math.abs(artRatio - slotRatio) / slotRatio;

    if (ratioDiff <= RATIO_TOLERANCE) {
      // Ratios match, use full artwork
      return `https://www.artic.edu/iiif/2/${artwork.imageId}/full/${reqWidth},/0/default.jpg`;
    }

    // Crop artwork to match slot ratio
    let cropWidth, cropHeight, cropX, cropY;
    if (slotRatio > artRatio) {
      // Slot is wider than artwork, crop height
      cropWidth = artwork.width;
      cropHeight = Math.round(artwork.width / slotRatio);
      cropX = 0;
      cropY = Math.round((artwork.height - cropHeight) / 2);
    } else {
      // Slot is taller than artwork, crop width
      cropHeight = artwork.height;
      cropWidth = Math.round(artwork.height * slotRatio);
      cropX = Math.round((artwork.width - cropWidth) / 2);
      cropY = 0;
    }

    return `https://www.artic.edu/iiif/2/${artwork.imageId}/${cropX},${cropY},${cropWidth},${cropHeight}/${reqWidth},/0/default.jpg`;
  }

  /**
   * Escape HTML text to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Determine how to fit image into slot.
   */
  function getObjectFit(slotWidth, slotHeight) {
    const ratio = slotWidth / slotHeight;
    // 'cover' for extreme aspect ratios (very wide or tall)
    // 'contain' for normal rectangles
    return (ratio > 3 || ratio < 0.33) ? 'cover' : 'contain';
  }

  /**
   * Create DOM elements for art replacement.
   */
  function createArtContainer(artwork, slotWidth, slotHeight) {
    // container
    const container = document.createElement('div');
    container.className = 'art-replacer-container';
    container.style.cssText = `width:${slotWidth}px;height:${slotHeight}px;position:relative;overflow:hidden;`;

    // img
    const imageUrl = buildArtImageUrl(artwork, slotWidth, slotHeight);
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = `${artwork.title} by ${artwork.artist}`;
    img.className = 'art-replacer-image';
    img.style.cssText = `width:100%;height:100%;object-fit:${getObjectFit(slotWidth, slotHeight)};`;
    container.appendChild(img);

    // artwork info
    const tooltip = document.createElement('div');
    tooltip.className = 'art-replacer-tooltip';
    const dateStr = artwork.date ? ` (${escapeHtml(artwork.date)})` : '';
    tooltip.innerHTML = `
      <div class="art-replacer-title">${escapeHtml(artwork.title)}</div>
      <div class="art-replacer-meta">${escapeHtml(artwork.artist)}${dateStr}</div>
      <div class="art-replacer-source">${escapeHtml(artwork.source)}</div>
    `;
    container.appendChild(tooltip);

    return container;
  }

  /**
   * Replace a single ad element with artwork.
   */
  async function replaceAd(adElement) {
    // skip if already processed
    if (adElement.dataset.artReplacer === 'replaced' || adElement.dataset.artReplacer === 'replacing') {
      return;
    }

    const rect = adElement.getBoundingClientRect();
    const width = Math.round(rect.width || adElement.offsetWidth || 0);
    const height = Math.round(rect.height || adElement.offsetHeight || 0);

    // skip if too small
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) return;

    adElement.dataset.artReplacer = 'replacing';

    try {
      // request artwork from service worker
      const response = await chrome.runtime.sendMessage({
        type: 'GET_ART',
        width,
        height,
      });

      if (!response?.artwork) {
        adElement.dataset.artReplacer = 'failed';
        return;
      }

      const artwork = response.artwork;
      const artContainer = createArtContainer(artwork, width, height);

      // handle iframes differently (need to replace in parent)
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
        // for other elements clear contents and add container
        adElement.innerHTML = '';
        adElement.appendChild(artContainer);
      }

      artContainer.dataset.artReplacer = 'replaced';

    } catch (error) {
      if (DEBUG) console.warn('[Art Replacer] Failed to replace ad:', error);
      adElement.dataset.artReplacer = 'failed';
    }
  }

  /**
   * Replace multiple ads sequentially.
   */
  async function replaceAds(adElements) {
    for (const ad of adElements) {
      await replaceAd(ad);
    }
  }

  function enqueueReplacement(adElements) {
    replaceQueue = replaceQueue
      .then(() => replaceAds(adElements))
      .catch((error) => {
        if (DEBUG) console.warn('[Art Replacer] Queue error:', error);
      });

    return replaceQueue;
  }

  // replace existing ads on page load
  const initialAds = AR.detectAds(document);
  if (initialAds.length > 0) {
    if (DEBUG) console.log(`[Art Replacer] Found ${initialAds.length} ads on load`);
    await enqueueReplacement(initialAds);
  }

  // watch for new ads
  if (AR.startObserver) {
    AR.startObserver(async (newAds) => {
      if (newAds.length > 0) {
        if (DEBUG) console.log(`[Art Replacer] Found ${newAds.length} new ads`);
        await enqueueReplacement(newAds);
      }
    });
  }

  // reload when the user flips the toggle so the change applies immediately
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enabled) {
      location.reload();
    }
  });
})();
