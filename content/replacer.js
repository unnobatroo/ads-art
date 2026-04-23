/**
 * AD REPLACER
 * Replaces detected ads with artwork from various sources.
 */

(async function () {
  const AR = window.__artReplacer;
  if (!AR) return;

  // Get extension settings
  const settings = await chrome.storage.sync.get({ enabled: true, category: 'all' });
  if (!settings.enabled) return;

  const MIN_DIMENSION = 50;
  const RATIO_TOLERANCE = 0.2;
  const DEBUG = false; // Set to true for logging

  /**
   * Build image URL for Art Institute of Chicago artwork
   * Crops if needed to match target aspect ratio
   */
  function buildArtImageUrl(artwork, slotWidth, slotHeight) {
    if (!artwork.imageId) {
      return artwork.smallImageUrl || artwork.imageUrl || '';
    }

    // Request higher resolution (up to 843x843)
    const reqWidth = Math.min(Math.round(slotWidth * 2), 843);
    const reqHeight = Math.min(Math.round(slotHeight * 2), 843);

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
      <strong>${escapeHtml(artwork.title)}</strong><br>
      ${escapeHtml(artwork.artist)}${dateStr}<br>
      <span class="art-replacer-source">${escapeHtml(artwork.source)}</span>
    `;
    container.appendChild(tooltip);

    return container;
  }

  /**
   * Replace a single ad element with artwork.
   */
  async function replaceAd(adElement) {
    // skip if already processed
    if (adElement.dataset.artReplacer === 'replaced') return;

    const width = adElement.offsetWidth;
    const height = adElement.offsetHeight;

    // skip if too small
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) return;

    adElement.dataset.artReplacer = 'replacing';

    try {
      // request artwork from service worker
      const response = await chrome.runtime.sendMessage({
        type: 'GET_ART',
        width,
        height,
        category: settings.category,
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
      chrome.runtime.sendMessage({ type: 'INCREMENT_COUNT' }).catch(() => { });

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

  // replace existing ads on page load
  const initialAds = AR.detectAds(document);
  if (initialAds.length > 0) {
    if (DEBUG) console.log(`[Art Replacer] Found ${initialAds.length} ads on load`);
    await replaceAds(initialAds);
  }

  // watch for new ads
  if (AR.startObserver) {
    AR.startObserver(async (newAds) => {
      if (newAds.length > 0) {
        if (DEBUG) console.log(`[Art Replacer] Found ${newAds.length} new ads`);
        await replaceAds(newAds);
      }
    });
  }

  // react to settings changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.enabled?.newValue === false) {
        location.reload();
      }
      if (changes.category) {
        settings.category = changes.category.newValue;
      }
    }
  });
})();
