/**
 * PAGE OBSERVER
 * Watches for newly added DOM elements and detects ads in them.
 */

const MAX_OBSERVER_ERRORS = 3;
const IGNORE_TAGS = new Set(['br', 'head', 'link', 'meta', 'script', 'style']);

window.__artReplacer = window.__artReplacer || {};

window.__artReplacer.startObserver = function (onAdFound) {
  if (typeof onAdFound !== 'function') return null;

  const addedNodeLists = [];
  const removedNodeLists = [];
  const addedNodes = [];
  let removedNodes = false;
  let errorCount = 0;
  let flushTimer = null;

  const scheduleFlush = (delayMs) => {
    if (flushTimer !== null) return;

    if (typeof delayMs === 'number') {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushPending();
      }, delayMs);
      return;
    }

    flushTimer = requestAnimationFrame(() => {
      flushTimer = null;
      flushPending();
    });
  };

  const collectAddedNodes = () => {
    let i = addedNodeLists.length;
    while (i--) {
      const nodeList = addedNodeLists[i];
      let j = nodeList.length;
      while (j--) {
        const node = nodeList[j];
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (IGNORE_TAGS.has(node.localName)) continue;
        if (node.parentElement === null) continue;
        addedNodes.push(node);
      }
    }
    addedNodeLists.length = 0;

    i = removedNodeLists.length;
    while (i-- && removedNodes === false) {
      const nodeList = removedNodeLists[i];
      let j = nodeList.length;
      while (j--) {
        if (nodeList[j].nodeType !== Node.ELEMENT_NODE) continue;
        removedNodes = true;
        break;
      }
    }
    removedNodeLists.length = 0;
  };

  const collectAdsFromNodes = () => {
    if (addedNodes.length === 0 && removedNodes === false) return;

    const detectAds = window.__artReplacer.detectAds;
    if (!detectAds) {
      addedNodes.length = 0;
      removedNodes = false;
      return;
    }

    const foundAds = new Set();
    for (const node of addedNodes) {
      if (node.classList?.contains('art-replacer-container')) continue;
      if (node.closest?.('.art-replacer-container')) continue;

      const ads = detectAds(node);
      if (Array.isArray(ads)) {
        for (const ad of ads) foundAds.add(ad);
      }
    }

    addedNodes.length = 0;
    removedNodes = false;

    if (foundAds.size > 0) {
      onAdFound([...foundAds]);
    }
  };

  const flushPending = () => {
    collectAddedNodes();
    collectAdsFromNodes();
  };

  const observer = new MutationObserver((mutations) => {
    try {
      let i = mutations.length;
      while (i--) {
        const mutation = mutations[i];
        if (mutation.addedNodes.length !== 0) {
          addedNodeLists.push(mutation.addedNodes);
        }
        if (mutation.removedNodes.length !== 0) {
          removedNodeLists.push(mutation.removedNodes);
        }
      }

      if (addedNodeLists.length !== 0 || removedNodeLists.length !== 0) {
        scheduleFlush(addedNodeLists.length < 100 ? 1 : undefined);
      }
    } catch (error) {
      errorCount++;
      if (errorCount >= MAX_OBSERVER_ERRORS) {
        observer.disconnect();
      }
    }
  });

  // watch entire document for changes
  const root = document.body || document.documentElement;
  if (!root) return null;

  observer.observe(root, {
    childList: true,
    subtree: true,
  });

  return observer;
};
