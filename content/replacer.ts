// Swaps detected ad slots for museum artwork.

(async function () {
  const AR = window.__artReplacer;
  if (!AR?.detectAds) return;

  const settings = await chrome.storage.sync.get({ enabled: true });
  if (settings.enabled === false) return;

  const MIN_DIMENSION = 50;
  const RATIO_TOLERANCE = 0.2;
  const IMAGE_LOAD_TIMEOUT = 8000;
  const SIZE_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000];
  const sizeRetryCounts = new WeakMap<HTMLElement, number>();

  function getDevicePixelRatio(): number {
    return Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  }

  // Snapping to standard IIIF widths lets the CDN reuse a cached derivative
  // instead of generating a fresh resize for every odd per-slot width.
  const IIIF_WIDTH_BUCKETS = [200, 400, 600, 843, 1200, 1686];

  function bucketWidth(width: number): number {
    for (const bucket of IIIF_WIDTH_BUCKETS) {
      if (width <= bucket) return bucket;
    }
    return IIIF_WIDTH_BUCKETS[IIIF_WIDTH_BUCKETS.length - 1] ?? 1686;
  }

  // Build the image URL for an artwork, cropping AIC pieces to the slot ratio.
  function buildArtImageUrl(
    artwork: Artwork,
    slotWidth: number,
    slotHeight: number
  ): string {
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
    let cropWidth: number;
    let cropHeight: number;
    let cropX: number;
    let cropY: number;
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
  function getObjectFit(slotWidth: number, slotHeight: number): 'cover' | 'contain' {
    const ratio = slotWidth / slotHeight;
    return (ratio > 3 || ratio < 0.33) ? 'cover' : 'contain';
  }

  function makeLine(className: string, text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    return el;
  }

  function loadImage(img: HTMLImageElement, src: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (loaded: boolean): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(loaded);
      };
      const timeout = window.setTimeout(() => finish(false), IMAGE_LOAD_TIMEOUT);

      img.addEventListener('load', () => finish(img.naturalWidth > 0), { once: true });
      img.addEventListener('error', () => finish(false), { once: true });
      img.src = src;
    });
  }

  async function createArtContainer(
    artwork: Artwork,
    slotWidth: number,
    slotHeight: number
  ): Promise<HTMLDivElement | null> {
    const imageUrl = buildArtImageUrl(artwork, slotWidth, slotHeight);
    if (!imageUrl) return null;

    const container = document.createElement('div');
    container.className = 'art-replacer-container';
    container.tabIndex = 0;
    container.style.cssText = `width:${slotWidth}px;height:${slotHeight}px;position:relative;overflow:hidden;`;

    const img = document.createElement('img');
    img.decoding = 'async';
    img.loading = 'eager';
    img.alt = `${artwork.title} by ${artwork.artist}`;
    img.className = 'art-replacer-image';
    img.style.cssText = `width:100%;height:100%;object-fit:${getObjectFit(slotWidth, slotHeight)};`;
    if (!await loadImage(img, imageUrl)) return null;
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

  async function replaceAd(adElement: HTMLElement): Promise<void> {
    if (adElement.dataset.artReplacer) return;

    const rect = adElement.getBoundingClientRect();
    const width = Math.round(rect.width || adElement.offsetWidth || 0);
    const height = Math.round(rect.height || adElement.offsetHeight || 0);
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      const retryCount = sizeRetryCounts.get(adElement) ?? 0;
      const retryDelay = SIZE_RETRY_DELAYS_MS[retryCount];
      if (retryDelay === undefined) {
        adElement.dataset.artReplacer = 'skipped';
        sizeRetryCounts.delete(adElement);
        return;
      }

      sizeRetryCounts.set(adElement, retryCount + 1);
      adElement.dataset.artReplacer = 'waiting';
      window.setTimeout(() => {
        if (!adElement.isConnected || adElement.dataset.artReplacer !== 'waiting') return;
        delete adElement.dataset.artReplacer;
        void replaceAd(adElement);
      }, retryDelay);
      return;
    }

    sizeRetryCounts.delete(adElement);
    adElement.dataset.artReplacer = 'loading';

    try {
      const message: GetArtMessage = { type: 'GET_ART', width, height };
      const response = await chrome.runtime.sendMessage<GetArtMessage, GetArtResponse>(message);
      if (!response?.artwork) {
        adElement.dataset.artReplacer = 'failed';
        return;
      }

      const artwork = response.artwork;
      const artContainer = await createArtContainer(artwork, width, height);
      if (!artContainer) {
        adElement.dataset.artReplacer = 'failed';
        return;
      }

      adElement.dataset.artReplacer = 'replacing';

      // Iframes and custom elements may hide their children in another
      // document or shadow tree, so replace the host itself.
      const replaceHost = adElement.tagName === 'IFRAME' || adElement.tagName.includes('-');
      if (replaceHost) {
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
        adElement.dataset.artReplacer = 'replaced';
      }

      artContainer.dataset.artReplacer = 'replaced';

    } catch (error) {
      console.warn('[Ads Art] Failed to replace ad:', error);
      adElement.dataset.artReplacer = 'failed';
    }
  }

  async function replaceAds(adElements: HTMLElement[]): Promise<void> {
    await Promise.all(adElements.map(replaceAd));
  }

  // Existing ads on load.
  const initialAds = AR.detectAds(document);
  if (initialAds.length > 0) {
    await replaceAds(initialAds);
  }

  // Ads injected later.
  if (AR.startObserver) {
    AR.startObserver(async (newAds) => {
      if (newAds.length > 0) {
        await replaceAds(newAds);
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
