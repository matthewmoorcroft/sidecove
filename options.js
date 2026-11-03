/**
 * Options - Extension settings and preferences UI
 * 
 * Purpose: Provides user interface for configuring extension behavior and preferences
 * Key Functions: Auto-archive settings, default space configuration, extension preferences management
 * Architecture: Options page that syncs with chrome.storage for persistent settings
 * 
 * Critical Notes:
 * - Settings are synced across devices via chrome.storage.sync
 * - Auto-archive timing affects background script alarm configuration
 * - Changes trigger background script updates via message passing
 * - Provides real-time feedback for setting changes
 */

import { Utils, normalizePinMatchHost } from './utils.js';
import { LocalStorage } from './localstorage.js';
import { Logger } from './logger.js';
import { COLOR_NAMES, DEFAULT_LIGHT_COLORS, DEFAULT_DARK_COLORS, applyOverrideProperties, changedColors } from './color-overrides.js';

// Light-mode pickers keep their original ids (colorBlue); dark-mode pickers add "Dark".
function getColorPickerId(colorName, mode = 'light') {
  return `color${colorName.charAt(0).toUpperCase() + colorName.slice(1)}${mode === 'dark' ? 'Dark' : ''}`;
}

const DEFAULTS_BY_MODE = { light: DEFAULT_LIGHT_COLORS, dark: DEFAULT_DARK_COLORS };

function pickerValues(mode) {
  return Object.fromEntries(COLOR_NAMES.map(name => [name, document.getElementById(getColorPickerId(name, mode))?.value]));
}

// Helper to safely get checkbox value with default
function getCheckboxValue(element, defaultValue) {
  return element ? element.checked : defaultValue;
}

// Helper to safely set checkbox value with default
function setCheckboxValue(element, value, defaultValue) {
  if (element) {
    element.checked = value !== undefined ? value : defaultValue;
  }
}

// Parse the pinned-tab-matching host list: comma or whitespace separated,
// optional :port (e.g. "localhost:6969, docs.corp.example.com"). Pasted URLs are
// reduced to their host; entries that are not a host are dropped.
function parseHostList(value) {
  return (value || '')
    .split(/[\s,]+/)
    .map(normalizePinMatchHost)
    .filter(Boolean);
}

// Helper to add event listener if element exists
function addListenerIfExists(elementId, event, handler) {
  const element = document.getElementById(elementId);
  if (element) {
    element.addEventListener(event, handler);
  }
  return element;
}

function updateAutoArchiveIdleMinutesVisibility(forceEnabled) {
  const container = document.getElementById('autoArchiveIdleMinutesContainer');
  const checkbox = document.getElementById('autoArchiveEnabled');
  const input = document.getElementById('autoArchiveIdleMinutes');
  if (!container || !checkbox || !input) return;

  const isEnabled = forceEnabled !== undefined ? Boolean(forceEnabled) : Boolean(checkbox.checked);
  container.style.display = isEnabled ? '' : 'none';
  input.disabled = !isEnabled;
}

// Function to save options to chrome.storage
async function saveOptions() {
  const defaultSpaceNameSelect = document.getElementById('defaultSpaceName');
  const autoArchiveIdleMinutesInput = document.getElementById('autoArchiveIdleMinutes');
  if (autoArchiveIdleMinutesInput && !autoArchiveIdleMinutesInput.disabled && !autoArchiveIdleMinutesInput.reportValidity()) return;

  const settings = {
    defaultSpaceName: defaultSpaceNameSelect?.value || 'Home',
    autoArchiveEnabled: getCheckboxValue(document.getElementById('autoArchiveEnabled'), false),
    autoArchiveIdleMinutes: parseInt(autoArchiveIdleMinutesInput?.value, 10) || 360,
    syncTabGroups: getCheckboxValue(document.getElementById('syncTabGroups'), false),
    invertTabOrder: getCheckboxValue(document.getElementById('invertTabOrder'), true),
    showAllOpenTabsInCollapsedFolders: getCheckboxValue(document.getElementById('showAllOpenTabsInCollapsedFolders'), false),
    spaceSwitcherStyle: document.getElementById('spaceSwitcherStyle')?.value === 'names' ? 'names' : 'icons',
    pinMatchFullQueryHosts: parseHostList(document.getElementById('pinMatchFullQueryHosts')?.value),
    colorOverrides: changedColors(pickerValues('light'), DEFAULT_LIGHT_COLORS),
    colorOverridesDarkMode: changedColors(pickerValues('dark'), DEFAULT_DARK_COLORS),
    debugLoggingEnabled: getCheckboxValue(document.getElementById('debugLoggingEnabled'), false)
  };

  try {
    await chrome.storage.sync.set(settings);
    Logger.log('Settings saved:', settings);

    applyOverrideProperties(document.documentElement, settings.colorOverrides, settings.colorOverridesDarkMode);
    await chrome.runtime.sendMessage({ action: 'updateAutoArchiveSettings' });
    showToast();
  } catch (error) {
    Logger.error('Error saving settings:', error);
    showToast('Could not save settings. Please try again.');
  }
}

// Function to show toast notification
let toastTimeout;
function showToast(message = 'Settings saved') {
  const toast = document.getElementById('saveToast');
  if (!toast) return;

  toast.querySelector('.toast-message').textContent = message;
  clearTimeout(toastTimeout);
  toast.classList.add('show');

  // Remove show class after 2 seconds
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

// Function to restore options from chrome.storage
async function restoreOptions() {
  const settings = await Utils.getSettings();

  await populateSpacesDropdown(settings.defaultSpaceName);

  // Restore checkbox values
  setCheckboxValue(document.getElementById('autoArchiveEnabled'), settings.autoArchiveEnabled, false);
  setCheckboxValue(document.getElementById('syncTabGroups'), settings.syncTabGroups, false);
  setCheckboxValue(document.getElementById('invertTabOrder'), settings.invertTabOrder, true);
  setCheckboxValue(document.getElementById('showAllOpenTabsInCollapsedFolders'), settings.showAllOpenTabsInCollapsedFolders, false);
  setCheckboxValue(document.getElementById('debugLoggingEnabled'), settings.debugLoggingEnabled, false);
  const spaceSwitcherStyle = document.getElementById('spaceSwitcherStyle');
  if (spaceSwitcherStyle) spaceSwitcherStyle.value = settings.spaceSwitcherStyle === 'names' ? 'names' : 'icons';

  // Restore pinned-tab-matching host list
  const pinMatchFullQueryHostsInput = document.getElementById('pinMatchFullQueryHosts');
  if (pinMatchFullQueryHostsInput) {
    pinMatchFullQueryHostsInput.value = (settings.pinMatchFullQueryHosts || []).join(', ');
  }

  // Restore number input
  const autoArchiveIdleMinutesInput = document.getElementById('autoArchiveIdleMinutes');
  if (autoArchiveIdleMinutesInput) {
    autoArchiveIdleMinutesInput.value = settings.autoArchiveIdleMinutes;
  }
  updateAutoArchiveIdleMinutesVisibility(settings.autoArchiveEnabled);

  // Restore color overrides (light and dark mode)
  const overridesByMode = { light: settings.colorOverrides || {}, dark: settings.colorOverridesDarkMode || {} };
  for (const [mode, overrides] of Object.entries(overridesByMode)) {
    COLOR_NAMES.forEach(colorName => {
      const colorPicker = document.getElementById(getColorPickerId(colorName, mode));
      if (colorPicker) colorPicker.value = overrides[colorName] || DEFAULTS_BY_MODE[mode][colorName];
    });
  }

  applyOverrideProperties(document.documentElement, settings.colorOverrides, settings.colorOverridesDarkMode);
}

// Function to populate the spaces dropdown
async function populateSpacesDropdown(selectedSpaceName) {
  const defaultSpaceNameSelect = document.getElementById('defaultSpaceName');

  try {
    // Get space names using the LocalStorage utility function
    const spaceNames = await LocalStorage.getSpaceNames();

    // Clear existing options
    defaultSpaceNameSelect.innerHTML = '';

    // Add space options
    spaceNames.forEach(spaceName => {
      const option = document.createElement('option');
      option.value = spaceName;
      option.textContent = spaceName;
      defaultSpaceNameSelect.appendChild(option);
    });

    // Only add default "Home" option if no spaces were found
    if (spaceNames.length === 0) {
      const defaultOption = document.createElement('option');
      defaultOption.value = 'Home';
      defaultOption.textContent = 'Home';
      defaultSpaceNameSelect.appendChild(defaultOption);
    }

    // Set the selected value
    defaultSpaceNameSelect.value = spaceNames.includes(selectedSpaceName) ? selectedSpaceName : (spaceNames[0] || 'Home');

  } catch (error) {
    Logger.error('Error loading spaces:', error);
    // Fallback to default option if there's an error
    defaultSpaceNameSelect.innerHTML = '<option value="Home">Home</option>';
    defaultSpaceNameSelect.value = 'Home';
  }
}

// Function to setup advanced options toggle
function setupAdvancedOptions() {
  const toggle = document.getElementById('advancedOptionsToggle');
  const content = document.getElementById('advancedOptionsContent');

  if (toggle && content) {
    toggle.addEventListener('click', () => {
      const isExpanded = content.style.display !== 'none';
      content.style.display = isExpanded ? 'none' : 'block';
      toggle.classList.toggle('expanded', !isExpanded);
      toggle.setAttribute('aria-expanded', String(!isExpanded));
    });
  }

  // Setup color reset buttons
  document.querySelectorAll('.color-reset-btn').forEach(button => {
    button.addEventListener('click', () => {
      const colorName = button.dataset.color;
      const mode = button.dataset.mode === 'dark' ? 'dark' : 'light';
      const colorPicker = document.getElementById(getColorPickerId(colorName, mode));
      if (colorPicker && DEFAULTS_BY_MODE[mode][colorName]) {
        colorPicker.value = DEFAULTS_BY_MODE[mode][colorName];
        saveOptions();
      }
    });
  });
}

// Debounce function to avoid excessive saves for color pickers
let saveTimeout;
function debouncedSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveOptions();
  }, 500); // Wait 500ms after last change before saving
}

// Function to setup auto-save listeners
function setupAutoSave() {
  // Auto-save for dropdown
  addListenerIfExists('defaultSpaceName', 'change', saveOptions);
  addListenerIfExists('spaceSwitcherStyle', 'change', saveOptions);

  // Auto-save for checkboxes (most just save immediately)
  const checkboxIds = ['syncTabGroups', 'invertTabOrder', 'showAllOpenTabsInCollapsedFolders', 'debugLoggingEnabled'];
  checkboxIds.forEach(id => addListenerIfExists(id, 'change', saveOptions));

  // Auto-archive checkbox needs special handling to update visibility
  const autoArchiveCheckbox = addListenerIfExists('autoArchiveEnabled', 'change', () => {
    updateAutoArchiveIdleMinutesVisibility(autoArchiveCheckbox?.checked);
    saveOptions();
  });

  // Auto-save for number input (with debounce)
  addListenerIfExists('autoArchiveIdleMinutes', 'input', debouncedSave);

  // Auto-save for the pinned-tab-matching host list (with debounce)
  addListenerIfExists('pinMatchFullQueryHosts', 'input', debouncedSave);

  // Auto-save for color pickers (with debounce)
  COLOR_NAMES.forEach(colorName => {
    addListenerIfExists(getColorPickerId(colorName, 'light'), 'input', debouncedSave);
    addListenerIfExists(getColorPickerId(colorName, 'dark'), 'input', debouncedSave);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();
  setupAdvancedOptions();
  setupAutoSave();
});
