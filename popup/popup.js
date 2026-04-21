/**
 * POPUP SCRIPT
 * Manages the extension popup UI and settings.
 */

// DOM elements
const enabledToggle = document.getElementById('enabled');
const powerToggleEl = document.querySelector('.power-toggle');
const categoryButtons = [...document.querySelectorAll('[data-category]')];
const countDisplay = document.getElementById('count');

const VALID_CATEGORIES = ['all', 'art', 'nasa'];
const DEFAULT_CATEGORY = 'art';

/**
 * Normalize category to a valid value
 */
function normalizeCategory(category) {
  return VALID_CATEGORIES.includes(category) ? category : DEFAULT_CATEGORY;
}

/**
 * Update active button in category selector
 */
function setActiveCategory(category) {
  const normalized = normalizeCategory(category);

  categoryButtons.forEach(button => {
    const isActive = button.dataset.category === normalized;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  return normalized;
}

/**
 * Update power toggle display state
 */
function setPowerState(isEnabled) {
  if (!powerToggleEl) return;

  powerToggleEl.dataset.state = isEnabled ? 'on' : 'off';

  const label = powerToggleEl.querySelector('.power-toggle-ui');
  if (label) {
    label.textContent = isEnabled ? 'on' : 'off';
  }
}

/**
 * Update counter display
 */
function updateCounter(count) {
  countDisplay.textContent = count || '0';
}

// ===== Initialize =====

// Load saved settings
chrome.storage.sync.get({ enabled: true, category: 'all' }, (settings) => {
  enabledToggle.checked = settings.enabled;
  setPowerState(settings.enabled);

  const category = setActiveCategory(settings.category);
  if (category !== settings.category) {
    chrome.storage.sync.set({ category });
  }
});

// Load replacement counter
chrome.runtime.sendMessage({ type: 'GET_COUNT' }, (response) => {
  if (response?.totalReplaced) {
    updateCounter(response.totalReplaced);
  }
});

// ===== Event Listeners =====

// Toggle extension on/off
enabledToggle.addEventListener('change', () => {
  setPowerState(enabledToggle.checked);
  chrome.storage.sync.set({ enabled: enabledToggle.checked });
});

// Switch between art categories
categoryButtons.forEach(button => {
  button.addEventListener('click', () => {
    const category = setActiveCategory(button.dataset.category);
    chrome.storage.sync.set({ category });
  });
});
