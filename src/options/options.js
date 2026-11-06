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

import { Utils, normalizePinMatchHost } from '../shared/utils.js';
import { LocalStorage } from '../shared/localstorage.js';
import { Logger } from '../shared/logger.js';
import {
    COLOR_NAMES,
    LIGHT_DEFAULTS,
    DARK_DEFAULTS,
    applyColorVariables,
    buildColorOverrides,
    readColorOverrides
} from '../shared/color-palette.js';

// The color pickers' ids: colorGrey for the light value, colorGreyDark for the dark one.
function getColorPickerId(colorName, mode) {
    const id = `color${colorName.charAt(0).toUpperCase() + colorName.slice(1)}`;
    return mode === 'dark' ? `${id}Dark` : id;
}

const DEFAULTS_BY_MODE = { light: LIGHT_DEFAULTS, dark: DARK_DEFAULTS };

// Runs fn for each colour and mode with that mode's picker.
function forEachColorPicker(fn) {
    COLOR_NAMES.forEach(colorName => {
        Object.keys(DEFAULTS_BY_MODE).forEach(mode => {
            const picker = document.getElementById(getColorPickerId(colorName, mode));
            if (picker) fn(picker, colorName, mode);
        });
    });
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
    if (
        autoArchiveIdleMinutesInput &&
        !autoArchiveIdleMinutesInput.disabled &&
        !autoArchiveIdleMinutesInput.reportValidity()
    )
        return;

    // Collect color overrides (only non-default values)
    const picked = { light: {}, dark: {} };
    forEachColorPicker((picker, colorName, mode) => {
        picked[mode][colorName] = picker.value;
    });
    const colors = buildColorOverrides(picked.light, picked.dark);

    const settings = {
        defaultSpaceName: defaultSpaceNameSelect?.value || 'Home',
        autoArchiveEnabled: getCheckboxValue(document.getElementById('autoArchiveEnabled'), false),
        autoArchiveIdleMinutes: parseInt(autoArchiveIdleMinutesInput?.value, 10) || 360,
        perSpacePinnedFavorites: getCheckboxValue(document.getElementById('perSpacePinnedFavorites'), false),
        showTabsFromAllWindows: getCheckboxValue(document.getElementById('showTabsFromAllWindows'), false),
        syncTabGroups: getCheckboxValue(document.getElementById('syncTabGroups'), false),
        invertTabOrder: getCheckboxValue(document.getElementById('invertTabOrder'), true),
        closeEmptyNewTabs: getCheckboxValue(document.getElementById('closeEmptyNewTabs'), true),
        showAllOpenTabsInCollapsedFolders: getCheckboxValue(
            document.getElementById('showAllOpenTabsInCollapsedFolders'),
            false
        ),
        spaceSwitcherStyle: document.getElementById('spaceSwitcherStyle')?.value === 'names' ? 'names' : 'icons',
        pinMatchFullQueryHosts: parseHostList(document.getElementById('pinMatchFullQueryHosts')?.value),
        ...colors,
        debugLoggingEnabled: getCheckboxValue(document.getElementById('debugLoggingEnabled'), false)
    };

    try {
        await chrome.storage.sync.set(settings);
        Logger.log('Settings saved:', settings);

        applyColorVariables(document.documentElement, settings);
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
    setCheckboxValue(document.getElementById('perSpacePinnedFavorites'), settings.perSpacePinnedFavorites, false);
    setCheckboxValue(document.getElementById('showTabsFromAllWindows'), settings.showTabsFromAllWindows, false);
    setCheckboxValue(document.getElementById('syncTabGroups'), settings.syncTabGroups, false);
    setCheckboxValue(document.getElementById('invertTabOrder'), settings.invertTabOrder, true);
    setCheckboxValue(document.getElementById('closeEmptyNewTabs'), settings.closeEmptyNewTabs, true);
    setCheckboxValue(
        document.getElementById('showAllOpenTabsInCollapsedFolders'),
        settings.showAllOpenTabsInCollapsedFolders,
        false
    );
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

    // Restore color overrides
    const overrides = readColorOverrides(settings);
    forEachColorPicker((picker, colorName, mode) => {
        picker.value = overrides[mode][colorName] || DEFAULTS_BY_MODE[mode][colorName];
    });

    applyColorVariables(document.documentElement, settings);
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
        defaultSpaceNameSelect.value = spaceNames.includes(selectedSpaceName)
            ? selectedSpaceName
            : spaceNames[0] || 'Home';
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

    // Setup color reset buttons: each resets one picker, light or dark
    document.querySelectorAll('.color-reset-btn').forEach(button => {
        button.addEventListener('click', () => {
            const { color: colorName, mode } = button.dataset;
            const colorPicker = document.getElementById(getColorPickerId(colorName, mode));
            const defaultColor = DEFAULTS_BY_MODE[mode]?.[colorName];
            if (colorPicker && defaultColor) {
                colorPicker.value = defaultColor;
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
    addListenerIfExists('perSpacePinnedFavorites', 'change', saveOptions);
    addListenerIfExists('showTabsFromAllWindows', 'change', saveOptions);

    // Auto-save for checkboxes (most just save immediately)
    const checkboxIds = [
        'syncTabGroups',
        'invertTabOrder',
        'closeEmptyNewTabs',
        'showAllOpenTabsInCollapsedFolders',
        'debugLoggingEnabled'
    ];
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
    forEachColorPicker(picker => picker.addEventListener('input', debouncedSave));
}

document.addEventListener('DOMContentLoaded', () => {
    restoreOptions();
    setupAdvancedOptions();
    setupAutoSave();
});
