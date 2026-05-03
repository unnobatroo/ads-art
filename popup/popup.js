/**
 * POPUP SCRIPT
 * Manages the extension popup UI and settings.
 */

// DOM elements
const enabledToggle = document.getElementById('enabled');
const powerToggleEl = document.querySelector('.power-toggle');

let syncInProgress = false;

/**
 * Update power toggle display state
 */
function setPowerState(isEnabled) {
  if (!powerToggleEl) return;

  powerToggleEl.dataset.state = isEnabled ? 'on' : 'off';
  powerToggleEl.disabled = syncInProgress;

  const label = powerToggleEl.querySelector('.power-toggle-ui');
  if (label) {
    label.textContent = isEnabled ? 'on' : 'off';
  }
}

/**
 * Save settings to storage and handle sync state
 */
async function saveSetting(key, value) {
  syncInProgress = true;
  updateUIState();

  return new Promise(resolve => {
    chrome.storage.sync.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[Art Replacer] Failed to save setting:', chrome.runtime.lastError.message);
      }
      syncInProgress = false;
      updateUIState();
      resolve();
    });
  });
}

/**
 * Update UI based on sync state
 */
function updateUIState() {
  enabledToggle.disabled = syncInProgress;
  powerToggleEl.disabled = syncInProgress;
}

// ===== Initialize =====

// Load saved settings
chrome.storage.sync.get({ enabled: true }, (settings) => {
  enabledToggle.checked = settings.enabled;
  setPowerState(settings.enabled);
});

// ===== Event Listeners =====

// Toggle extension on/off
enabledToggle.addEventListener('change', () => {
  setPowerState(enabledToggle.checked);
  saveSetting('enabled', enabledToggle.checked);
});

