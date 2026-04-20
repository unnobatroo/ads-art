const enabledToggle = document.getElementById('enabled');
const powerToggle = document.querySelector('.power-toggle');
const categoryButtons = [...document.querySelectorAll('[data-category]')];
const countDisplay = document.getElementById('count');

function normalizeCategory(category) {
  if (category === 'nasa') return 'nasa';
  if (category === 'all' || category === 'art') return category;
  return 'art';
}

function setActiveCategory(category) {
  const nextCategory = normalizeCategory(category);
  for (const button of categoryButtons) {
    const isActive = button.dataset.category === nextCategory;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
  return nextCategory;
}

function setPowerState(isEnabled) {
  if (!powerToggle) return;
  powerToggle.dataset.state = isEnabled ? 'on' : 'off';
  const label = powerToggle.querySelector('.power-toggle-ui');
  if (label) {
    label.textContent = isEnabled ? 'on' : 'off';
  }
}

/** load saved ui state. */
chrome.storage.sync.get({ enabled: true, category: 'all' }, (settings) => {
  enabledToggle.checked = settings.enabled;
  setPowerState(settings.enabled);
  const category = setActiveCategory(settings.category);
  if (category !== settings.category) {
    chrome.storage.sync.set({ category });
  }
});

/** show the session count. */
chrome.runtime.sendMessage({ type: 'GET_COUNT' }, (response) => {
  if (response?.totalReplaced) {
    countDisplay.textContent = response.totalReplaced;
  }
});

/** save the toggle state. */
enabledToggle.addEventListener('change', () => {
  setPowerState(enabledToggle.checked);
  chrome.storage.sync.set({ enabled: enabledToggle.checked });
});

/** save the selected collection. */
for (const button of categoryButtons) {
  button.addEventListener('click', () => {
    const category = setActiveCategory(button.dataset.category);
    chrome.storage.sync.set({ category });
  });
}
