// On/off toggle for Ads Art, backed by synced storage.

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`[Ads Art] Missing popup element: ${selector}`);
  return element;
}

const enabledToggle = requireElement<HTMLInputElement>('#enabled');
const powerToggleEl = requireElement<HTMLLabelElement>('.power-toggle');
const powerToggleUi = requireElement<HTMLElement>('.power-toggle-ui');

let syncing = false;
let savedEnabled = true;

// Reflect the current enabled + syncing state in the UI.
function render(isEnabled: boolean): void {
  powerToggleEl.dataset.state = isEnabled ? 'on' : 'off';
  powerToggleEl.setAttribute('aria-disabled', String(syncing));
  powerToggleUi.textContent = isEnabled ? 'on' : 'off';
  enabledToggle.disabled = syncing;
}

// Persist the setting, disabling the UI while the write is in flight.
function saveEnabled(value: boolean): void {
  const previousValue = savedEnabled;
  syncing = true;
  render(value);
  chrome.storage.sync.set({ enabled: value }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[Ads Art] Failed to save setting:', chrome.runtime.lastError.message);
      enabledToggle.checked = previousValue;
      syncing = false;
      render(previousValue);
      return;
    }
    savedEnabled = value;
    syncing = false;
    render(value);
  });
}

// Load saved state, then wire up the toggle.
chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  const isEnabled = typeof enabled === 'boolean' ? enabled : true;
  savedEnabled = isEnabled;
  enabledToggle.checked = isEnabled;
  render(isEnabled);
});

enabledToggle.addEventListener('change', () => saveEnabled(enabledToggle.checked));
