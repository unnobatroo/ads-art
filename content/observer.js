/**
 * PAGE OBSERVER
 * Watches for newly added DOM elements and detects ads in them.
 */

const DEBOUNCE_DELAY = 200; // ms to wait after mutations before processing
const MAX_OBSERVER_ERRORS = 3;

window.__artReplacer = window.__artReplacer || {};

window.__artReplacer.startObserver = function(onAdFound) {
  if (typeof onAdFound !== 'function') return null;
  
  let debounceTimer = null;
  let errorCount = 0;

  const observer = new MutationObserver((mutations) => {
    try {
      // debounce to avoid processing too frequently
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // collect all newly added elements
        const newElements = mutations
          .flatMap(m => Array.from(m.addedNodes))
          .filter(node => node.nodeType === Node.ELEMENT_NODE);

        if (newElements.length === 0) return;

        // skip our own art replacements
        const filteredElements = newElements.filter(el =>
          !el.classList?.contains('art-replacer-container')
        );

        if (filteredElements.length === 0) return;

        // detect ads in newly added elements
        const detectAds = window.__artReplacer.detectAds;
        if (!detectAds) return;

        const foundAds = new Set();
        filteredElements.forEach(el => {
          const ads = detectAds(el);
          if (Array.isArray(ads)) {
            ads.forEach(ad => foundAds.add(ad));
          }
        });

        if (foundAds.size > 0) {
          onAdFound([...foundAds]);
        }
      }, DEBOUNCE_DELAY);
    } catch (error) {
      errorCount++;
      if (errorCount >= MAX_OBSERVER_ERRORS) {
        observer.disconnect();
      }
    }
  });

  // watch entire document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return observer;
