/**
 * AD DETECTOR
 * Finds ad slots on a page using a curated selector list plus a size heuristic.
 * Site chrome (nav bars, headers, search) is explicitly protected, so it is
 * never mistaken for an ad.
 */

// Precise, ad-tech-specific selectors. Hyphenated `ad-*` matches are safe from
// ordinary words; bare substrings like "ad" are deliberately avoided.
const AD_SELECTORS = [
  // Google / GPT slots
  'ins.adsbygoogle',
  '[id^="google_ads"]',
  '[id^="div-gpt-ad"]',
  '[id^="gpt-ad"]',
  '[data-ad-slot]',
  '[data-ad-client]',
  '[data-ad-format]',
  '[data-ad-unit-path]',
  '[data-google-query-id]',

  // Ad-network iframes
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="googleadservices.com"]',
  'iframe[src*="amazon-adsystem.com"]',
  'iframe[src*="adnxs.com"]',
  'iframe[src*="criteo.com"]',
  'iframe[src*="moatads.com"]',
  'iframe[src*="rubiconproject.com"]',
  'iframe[src*="pubmatic.com"]',
  'iframe[src*="openx.net"]',
  'iframe[src*="casalemedia.com"]',

  // Content-recommendation widgets (brand names → safe)
  '[class*="taboola"]', '[id*="taboola"]',
  '[class*="outbrain"]', '[id*="outbrain"]',

  // First-party ad containers
  '[class*="ad-container"]', '[id*="ad-container"]',
  '[class*="ad-wrapper"]', '[id*="ad-wrapper"]',
  '[class*="ad-banner"]', '[id*="ad-banner"]',
  '[class*="ad-slot"]',
  '[class*="ad-unit"]',
  '[class*="advertisement"]',

  // Custom ad elements
  'ad-slot', 'amp-ad', 'gpt-ad',
];

const SELECTOR_QUERY = AD_SELECTORS.join(',');

// Containers we must never touch, even if a descendant class coincidentally
// matches an ad selector.
const PROTECTED_SELECTOR =
  'header, nav, [role="banner"], [role="navigation"], [role="search"], [role="menubar"]';

// Standard IAB ad sizes (w × h), used as a structural fallback.
const IAB_AD_SIZES = [
  [728, 90], [300, 250], [160, 600], [320, 50], [300, 600],
  [970, 250], [970, 90], [336, 280], [120, 600], [320, 100],
];

const MIN_AD_SIZE = 50;
const SIZE_TOLERANCE = 0.15;

// Word-bounded ad hint; avoids matching "header", "download", "thread", etc.
const AD_HINT = /(?:^|[^a-z])(ads?|advert|advertisement|sponsored?|promo|banner)(?:[^a-z]|$)/i;

function isProtected(el) {
  return !!el.closest?.(PROTECTED_SELECTOR);
}

function safeMatches(el, selector) {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

function matchesAdSize(width, height) {
  if (width < MIN_AD_SIZE || height < MIN_AD_SIZE) return false;
  return IAB_AD_SIZES.some(([w, h]) =>
    Math.abs(width - w) / w <= SIZE_TOLERANCE &&
    Math.abs(height - h) / h <= SIZE_TOLERANCE
  );
}

function hasAdHint(el) {
  const meta = [
    el.className, el.id,
    el.getAttribute?.('aria-label'),
    el.getAttribute?.('data-testid'),
  ].filter(Boolean).join(' ');
  return AD_HINT.test(meta);
}

// A standard-sized, media-heavy block that also carries an ad hint is very
// likely an unlabelled ad slot.
function looksLikeAdBySize(el) {
  if (el.tagName !== 'IFRAME' && el.tagName !== 'DIV') return false;
  if (!matchesAdSize(el.offsetWidth, el.offsetHeight)) return false;
  if (!hasAdHint(el)) return false;
  if (el.tagName === 'IFRAME') return true;
  const textLength = (el.textContent?.trim() || '').length;
  return textLength < 20 && !!el.querySelector('img, iframe');
}

/**
 * Find all replaceable ad slots within a container.
 */
function detectAds(container = document) {
  const found = new Set();
  const isElement = container.nodeType === Node.ELEMENT_NODE;

  const add = (el) => {
    if (el && !el.dataset.artReplacer && !isProtected(el)) found.add(el);
  };

  // 1. Selector matches (precise).
  if (isElement && safeMatches(container, SELECTOR_QUERY)) add(container);
  try {
    container.querySelectorAll(SELECTOR_QUERY).forEach(add);
  } catch {
    // invalid selector list — should not happen, but never throw
  }

  // 2. Size + hint heuristic (catches unlabelled slots).
  const considerBySize = (el) => {
    if (!found.has(el) && looksLikeAdBySize(el)) add(el);
  };
  if (isElement) considerBySize(container);
  container.querySelectorAll('iframe, div').forEach(considerBySize);

  // 3. Drop anything nested inside another match or an existing replacement.
  return [...found].filter((el) => {
    let parent = el.parentElement;
    while (parent) {
      if (found.has(parent) || parent.dataset?.artReplacer) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

window.__artReplacer = window.__artReplacer || {};
window.__artReplacer.detectAds = detectAds;
