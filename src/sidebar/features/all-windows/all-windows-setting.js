import { ALL_WINDOWS_SETTING } from './all-windows.js';

// Tab events are handled synchronously, so the panel keeps the setting's value at hand. It is
// on unless turned off, including for people upgrading, who have never saved it.
export function trackAllWindowsSetting(storage, onChange = () => {}) {
    let enabled = true;
    const ready = storage.sync.get({ [ALL_WINDOWS_SETTING]: true }).then(result => {
        enabled = result[ALL_WINDOWS_SETTING] !== false;
    });
    storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes[ALL_WINDOWS_SETTING]) return;
        enabled = changes[ALL_WINDOWS_SETTING].newValue !== false;
        onChange(enabled);
    });
    return {
        ready,
        get enabled() {
            return enabled;
        }
    };
}
