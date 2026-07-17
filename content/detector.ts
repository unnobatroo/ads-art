// Finds likely ad slots while protecting navigation and other site controls.

const AD_SELECTORS = [
  'ins.adsbygoogle',
  '[id^="google_ads"]',
  '[id^="div-gpt-ad"]',
  '[id^="gpt-ad"]',
  '[data-ad-slot]',
  '[data-ad-client]',
  '[data-ad-format]',
  '[data-ad-unit-path]',
  '[ad-unit-path]',
  '[data-google-query-id]',
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
  '[class*="taboola"]',
  '[id*="taboola"]',
  '[class*="outbrain"]',
  '[id*="outbrain"]',
  'ad-slot',
  's24-ad-slot',
  'amp-ad',
  'gpt-ad',
];

const SELECTOR_QUERY = AD_SELECTORS.join(',');
const AD_CONTAINER_RE =
  /(?:^|[-_ ])ads?[-_ ](?:container|wrapper|banner|slot|unit|box|area|placeholder)/i;
const ADVERTISEMENT_RE = /(?:^|[-_ ])advert(?:ising|isement)?(?:[-_ ]|$)/i;
const PROTECTED_SELECTOR =
  'header, nav, [role="banner"], [role="navigation"], [role="search"], [role="menubar"]';
const IAB_AD_SIZES: ReadonlyArray<readonly [number, number]> = [
  [728, 90], [300, 250], [160, 600], [320, 50], [300, 600],
  [970, 250], [970, 90], [336, 280], [120, 600], [320, 100],
];
const MIN_AD_SIZE = 50;
const SIZE_TOLERANCE = 0.15;
const AD_HINT = /(?:^|[^a-z])(ads?|advert|advertisement|sponsored?|promo|banner)(?:[^a-z]|$)/i;

function matchesAdName(el: HTMLElement): boolean {
  const names = `${el.getAttribute('class') ?? ''} ${el.id}`;
  return AD_CONTAINER_RE.test(names) || ADVERTISEMENT_RE.test(names);
}

function matchesAdSize(width: number, height: number): boolean {
  if (width < MIN_AD_SIZE || height < MIN_AD_SIZE) return false;
  return IAB_AD_SIZES.some(([w, h]) =>
    Math.abs(width - w) / w <= SIZE_TOLERANCE &&
    Math.abs(height - h) / h <= SIZE_TOLERANCE
  );
}

function hasAdHint(el: HTMLElement): boolean {
  const metadata = [
    el.getAttribute('class'),
    el.id,
    el.getAttribute('aria-label'),
    el.getAttribute('data-testid'),
  ].filter(Boolean).join(' ');
  return AD_HINT.test(metadata);
}

function looksLikeAdBySize(el: HTMLElement): boolean {
  if (el.tagName !== 'IFRAME' && el.tagName !== 'DIV') return false;
  if (!matchesAdSize(el.offsetWidth, el.offsetHeight) || !hasAdHint(el)) return false;
  if (el.tagName === 'IFRAME') return true;
  const textLength = (el.textContent?.trim() ?? '').length;
  return textLength < 20 && Boolean(el.querySelector('img, iframe'));
}

function detectAds(container: Document | HTMLElement = document): HTMLElement[] {
  const found = new Set<HTMLElement>();
  const isElement = container instanceof HTMLElement;

  const add = (element: Element | null): void => {
    if (
      element instanceof HTMLElement
      && !element.dataset.artReplacer
      && !element.closest(PROTECTED_SELECTOR)
    ) {
      found.add(element);
    }
  };

  if (isElement && container.matches(SELECTOR_QUERY)) add(container);
  container.querySelectorAll(SELECTOR_QUERY).forEach(add);

  const addNamedContainer = (element: Element): void => {
    if (element instanceof HTMLElement && !found.has(element) && matchesAdName(element)) {
      add(element);
    }
  };
  if (isElement) addNamedContainer(container);
  container.querySelectorAll('[class],[id]').forEach(addNamedContainer);

  const addSizedContainer = (element: Element): void => {
    if (element instanceof HTMLElement && !found.has(element) && looksLikeAdBySize(element)) {
      add(element);
    }
  };
  if (isElement) addSizedContainer(container);
  container.querySelectorAll('iframe, div').forEach(addSizedContainer);

  return [...found].filter((element) => {
    let parent = element.parentElement;
    while (parent) {
      if (found.has(parent) || parent.dataset.artReplacer) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

const detectorApi = window.__artReplacer ?? {};
detectorApi.detectAds = detectAds;
window.__artReplacer = detectorApi;
