(async function () {
  const AR = window.__artReplacer;
  if (!AR) return;

  // stop early when disabled
  const settings = await chrome.storage.sync.get({ enabled: true, category: 'all' });
  if (!settings.enabled) return;

  let replaceCount = 0;

  /** build the image url for the target slot. */
  function getImageUrl(artwork, targetWidth, targetHeight) {
    if (artwork.imageId) {
      const w = Math.min(Math.round(targetWidth * 2), 843);
      const h = Math.min(Math.round(targetHeight * 2), 843);

      if (artwork.width && artwork.height) {
        const targetRatio = targetWidth / targetHeight;
        const artRatio = artwork.width / artwork.height;
        const ratioDiff = Math.abs(artRatio - targetRatio) / targetRatio;

        if (ratioDiff > 0.2) {
          let cropW, cropH, cropX, cropY;
          if (targetRatio > artRatio) {
            cropW = artwork.width;
            cropH = Math.round(artwork.width / targetRatio);
            cropX = 0;
            cropY = Math.round((artwork.height - cropH) / 2);
          } else {
            cropH = artwork.height;
            cropW = Math.round(artwork.height * targetRatio);
            cropX = Math.round((artwork.width - cropW) / 2);
            cropY = 0;
          }
          return `https://www.artic.edu/iiif/2/${artwork.imageId}/${cropX},${cropY},${cropW},${cropH}/${w},/0/default.jpg`;
        }
      }

      return `https://www.artic.edu/iiif/2/${artwork.imageId}/full/${w},/0/default.jpg`;
    }
    return artwork.smallImageUrl || artwork.imageUrl || '';
  }

  /** replace one ad slot with art. */
  async function replaceAdWithArt(adElement) {
    if (adElement.dataset.artReplacer === 'replaced') return;
    const w = adElement.offsetWidth;
    const h = adElement.offsetHeight;
    if (w < 50 || h < 50) return;

    adElement.dataset.artReplacer = 'replacing';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_ART',
        width: w,
        height: h,
        category: settings.category,
      });

      if (!response || !response.artwork) {
        adElement.dataset.artReplacer = 'failed';
        return;
      }

      const art = response.artwork;
      const imageUrl = getImageUrl(art, w, h);
      if (!imageUrl) {
        adElement.dataset.artReplacer = 'failed';
        return;
      }

      const container = document.createElement('div');
      container.className = 'art-replacer-container';
      container.style.cssText = `width:${w}px;height:${h}px;position:relative;overflow:hidden;`;

      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = `${art.title} by ${art.artist}`;
      img.className = 'art-replacer-image';
      const slotRatio = w / h;
      const fit = (slotRatio > 3 || slotRatio < 0.33) ? 'cover' : 'contain';
      img.style.cssText = `width:100%;height:100%;object-fit:${fit};`;

      const tooltip = document.createElement('div');
      tooltip.className = 'art-replacer-tooltip';
      tooltip.innerHTML = `
        <strong>${escapeHtml(art.title)}</strong><br>
        ${escapeHtml(art.artist)}${art.date ? ` (${escapeHtml(art.date)})` : ''}<br>
        <span class="art-replacer-source">${escapeHtml(art.source)}</span>
      `;

      container.appendChild(img);
      container.appendChild(tooltip);

      if (adElement.tagName === 'IFRAME') {
        const parent = adElement.parentElement;
        if (parent) {
          parent.insertBefore(container, adElement);
          container.dataset.artReplacer = 'replaced';
          adElement.remove();
          replaceCount++;
          chrome.runtime.sendMessage({ type: 'INCREMENT_COUNT' }).catch(() => { });
          return;
        }
        adElement.dataset.artReplacer = 'failed';
        return;
      }

      adElement.innerHTML = '';
      adElement.appendChild(container);
      adElement.dataset.artReplacer = 'replaced';
      replaceCount++;

      chrome.runtime.sendMessage({
        type: 'INCREMENT_COUNT',
      }).catch(() => { });

    } catch (e) {
      console.warn('[Art Replacer] Failed to replace ad:', e);
      adElement.dataset.artReplacer = 'failed';
    }
  }

  /** escape plain text for the tooltip. */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** replace ads one at a time. */
  async function processAds(adElements) {
    for (const ad of adElements) {
      await replaceAdWithArt(ad);
    }
  }

  const initialAds = AR.detectAds(document);
  if (initialAds.length > 0) {
    console.log(`[Art Replacer] found ${initialAds.length} ads`);
    await processAds(initialAds);
  }

  if (AR.startObserver) {
    AR.startObserver(async (newAds) => {
      if (newAds.length > 0) {
        console.log(`[Art Replacer] found ${newAds.length} new ads`);
        await processAds(newAds);
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.enabled?.newValue === false) {
        location.reload();
      }
      if (changes.category) settings.category = changes.category.newValue;
    }
  });
})();
