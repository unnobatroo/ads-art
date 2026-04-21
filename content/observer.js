/**
 * PAGE OBSERVER
 * Watches for newly added DOM elements and detects ads in them.
 */

const DEBOUNCE_DELAY = 200; // ms to wait after mutations before processing

window.__artReplacer = window.__artReplacer || {};

window.__artReplacer.startObserver = function(onAdFound) {
  let debounceTimer = null;

  const observer = new MutationObserver((mutations) => {
    // Debounce to avoid processing too frequently
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // Collect all newly added elements
      const newElements = mutations
        .flatMap(m => Array.from(m.addedNodes))
        .filter(node => node.nodeType === Node.ELEMENT_NODE);

      if (newElements.length === 0) return;

      // Skip our own art replacements
      const filteredElements = newElements.filter(el =>
        !el.classList?.contains('art-replacer-container')
      );

      if (filteredElements.length === 0) return;

      // Detect ads in newly added elements
      const detectAds = window.__artReplacer.detectAds;
      if (!detectAds) return;

      const foundAds = new Set();
      filteredElements.forEach(el => {
        detectAds(el).forEach(ad => foundAds.add(ad));
      });

      if (foundAds.size > 0) {
        onAdFound([...foundAds]);
      }
    }, DEBOUNCE_DELAY);
  });

  // Watch entire document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return observer;
};
