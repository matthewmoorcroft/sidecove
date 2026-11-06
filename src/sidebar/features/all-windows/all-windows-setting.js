import { ALL_WINDOWS_SETTING } from './all-windows.js';

// Tab events are handled synchronously, so the panel keeps the setting's value at hand.
export function trackAllWindowsSetting(storage, onChange = () => {}) {
    let enabled = false;
    const ready = storage.sync.get({ [ALL_WINDOWS_SETTING]: false }).then(result => {
        enabled = result[ALL_WINDOWS_SETTING] === true;
    });
    storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes[ALL_WINDOWS_SETTING]) return;
        enabled = changes[ALL_WINDOWS_SETTING].newValue === true;
        onChange(enabled);
    });
    return {
        ready,
        get enabled() {
            return enabled;
        }
    };
}
