// On/off toggle for Ads Art, backed by synced storage.

const enabledToggle = document.getElementById('enabled');
const powerToggleEl = document.querySelector('.power-toggle');

let syncing = false;

// Reflect the current enabled + syncing state in the UI.
function render(isEnabled) {
  powerToggleEl.dataset.state = isEnabled ? 'on' : 'off';
  powerToggleEl.querySelector('.power-toggle-ui').textContent = isEnabled ? 'on' : 'off';
  enabledToggle.disabled = powerToggleEl.disabled = syncing;
}

// Persist the setting, disabling the UI while the write is in flight.
function saveEnabled(value) {
  syncing = true;
  render(value);
  chrome.storage.sync.set({ enabled: value }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[Ads Art] Failed to save setting:', chrome.runtime.lastError.message);
    }
    syncing = false;
    render(value);
  });
}

// Load saved state, then wire up the toggle.
chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  enabledToggle.checked = enabled;
  render(enabled);
});

enabledToggle.addEventListener('change', () => saveEnabled(enabledToggle.checked));
