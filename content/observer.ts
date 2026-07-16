// Watches for ads added after the page loads.

const DEBOUNCE_DELAY = 200;
const observerApi = window.__artReplacer ?? {};
window.__artReplacer = observerApi;

observerApi.startObserver = function (
  onAdFound: (adElements: HTMLElement[]) => void | Promise<void>
): MutationObserver | null {
  const pendingElements = new Set<HTMLElement>();
  let debounceTimer: number | undefined;

  const flushPending = (): void => {
    const detectAds = observerApi.detectAds;
    if (!detectAds) return;

    const foundAds = new Set<HTMLElement>();
    for (const element of pendingElements) {
      if (!element.classList.contains('art-replacer-container')) {
        for (const ad of detectAds(element)) foundAds.add(ad);
      }
    }
    pendingElements.clear();

    if (foundAds.size > 0) {
      Promise.resolve(onAdFound([...foundAds])).catch((error) => {
        console.warn('[Ads Art] Observer callback failed:', error);
      });
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) pendingElements.add(node);
      }
    }

    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(flushPending, DEBOUNCE_DELAY);
  });

  const root = document.body || document.documentElement;
  if (!root) return null;

  observer.observe(root, { childList: true, subtree: true });
  return observer;
};
