/**
 * AD DETECTOR
 * Finds ad elements on the page using CSS selectors and heuristics.
 */

// CSS selectors to match ad elements by class, id, or data attributes
const AD_SELECTORS = [
  // google ads
  'ins.adsbygoogle',
  '[id^="google_ads"]',
  '[id^="div-gpt-ad"]',
  '[data-ad-slot]',
  '[data-ad-client]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="googleadservices.com"]',

  // generic ad patterns
  '[class*="ad-container"]',
  '[class*="ad-wrapper"]',
  '[class*="ad-banner"]',
  '[class*="ad-unit"]',
  '[class*="ad-slot"]',
  '[class*="advert-"]',
  '[class*="advertisement"]',
  '[id*="ad-container"]',
  '[id*="ad-wrapper"]',
  '[id*="ad-banner"]',

  // content recommendation networks
  '[id*="taboola"]',
  '[class*="taboola"]',
  '[id*="outbrain"]',
  '[class*="outbrain"]',
  '[class*="mgid"]',
  '[id*="mgid"]',
  '[class*="revcontent"]',
  '[id*="revcontent"]',

  // sponsored content
  '[class*="sponsored-content"]',
  '[class*="sponsored_content"]',
  '[class*="sponsored-post"]',
  '[class*="native-ad"]',
  '[data-testid*="ad"]',
  '[data-testid*="sponsored" i]',
  '[aria-label*="advertisement" i]',
  '[aria-label*="sponsored" i]',

  // ad network attributes
  '[data-ad-format]',
  '[data-ad-unit-path]',
  '[data-slot]',
  '[pbadslot]',

  // amazon and other ad iframes
  'iframe[src*="amazon-adsystem.com"]',
  'iframe[src*="adnxs.com"]',
  'iframe[src*="criteo.com"]',
  'iframe[src*="moatads.com"]',
  'iframe[src*="rubiconproject.com"]',
  'iframe[src*="pubmatic.com"]',
  'iframe[src*="openx.net"]',
  'iframe[src*="casalemedia.com"]',

  // animated GIFs and Flash banners
  'img[src*=".gif" i]',
  'object[type="application/x-shockwave-flash"]',
  'embed[type="application/x-shockwave-flash"]',
];

// standard IAB ad dimensions (width x height)
const IAB_AD_SIZES = [
  [728, 90], [300, 250], [160, 600], [320, 50], [300, 600],
  [970, 250], [970, 90], [336, 280], [120, 600], [320, 100],
];

const MIN_AD_SIZE = 50;
const SIZE_TOLERANCE = 0.15; // 15% tolerance for dimension matching

// known ad network domains
const AD_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'adnxs.com', 'amazon-adsystem.com', 'taboola.com', 'outbrain.com',
  'criteo.com', 'moatads.com', 'rubiconproject.com', 'pubmatic.com',
  'openx.net', 'casalemedia.com', 'serving-sys.com', 'adform.net',
];

/**
 * Check if an element's dimensions match standard ad sizes.
 */
function matchesAdDimension(width, height) {
  if (width < MIN_AD_SIZE || height < MIN_AD_SIZE) return false;

  return IAB_AD_SIZES.some(([stdWidth, stdHeight]) => {
    const widthMatch = Math.abs(width - stdWidth) / stdWidth <= SIZE_TOLERANCE;
    const heightMatch = Math.abs(height - stdHeight) / stdHeight <= SIZE_TOLERANCE;
    return widthMatch && heightMatch;
  });
}

/**
 * Check if an iframe's source domain is a known ad network.
 */
function isAdIframe(element) {
  const src = element.src || '';
  return AD_DOMAINS.some(domain => src.includes(domain));
}

/**
 * Use heuristics to determine if an element looks like an ad.
 */
function looksLikeAd(element) {
  if (element.tagName === 'IFRAME') {
    return isAdIframe(element);
  }

  // check if contains ad network iframes
  const hasAdIframe = Array.from(element.querySelectorAll('iframe'))
    .some(frame => isAdIframe(frame));
  if (hasAdIframe) return true;

  // small text + media = likely ad
  const textLength = (element.textContent?.trim() || '').length;
  const hasMedia = !!element.querySelector('img, iframe');
  return textLength < 20 && hasMedia;
}

/**
 * Find all ad elements in a container.
 */
function detectAds(container = document) {
  const found = new Set();
  const isElement = container.nodeType === Node.ELEMENT_NODE;

  // find elements matching CSS selectors
  for (const selector of AD_SELECTORS) {
    try {
      // check if container itself matches
      if (isElement && container.matches(selector) && !container.dataset.artReplacer) {
        found.add(container);
      }
      // find children matching selector
      container.querySelectorAll(selector).forEach(el => {
        if (!el.dataset.artReplacer) found.add(el);
      });
    } catch (e) {
      // invalid selector, skip
    }
  }

  /**
  * Find elements by dimension heuristics.
  */
  const checkDimensions = (el) => {
    if (found.has(el) || el.dataset.artReplacer) return;
    if (el.tagName !== 'IFRAME' && el.tagName !== 'DIV') return;

    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (matchesAdDimension(width, height) && looksLikeAd(el)) {
      found.add(el);
    }
  };

  if (isElement) checkDimensions(container);
  container.querySelectorAll('iframe, div').forEach(checkDimensions);

  // filter out nested duplicates and already processed ads
  return [...found].filter((el) => {
    if (el.dataset.artReplacer) return false;

    let parent = el.parentElement;
    while (parent) {
      if (found.has(parent) || parent.dataset?.artReplacer) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

// export detection function
window.__artReplacer = window.__artReplacer || {};
window.__artReplacer.detectAds = detectAds;
