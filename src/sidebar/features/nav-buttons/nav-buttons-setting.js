export const NAV_BUTTONS_SETTING = 'showNavButtons';

// Settings -> Show back, forward and reload buttons. On unless turned off, including for people
// upgrading, who have never saved it. Calls onChange with the value now and whenever it changes.
export function trackNavButtonsSetting(storage, onChange) {
    const ready = storage.sync.get({ [NAV_BUTTONS_SETTING]: true }).then(result => {
        onChange(result[NAV_BUTTONS_SETTING] !== false);
    });
    storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes[NAV_BUTTONS_SETTING]) return;
        onChange(changes[NAV_BUTTONS_SETTING].newValue !== false);
    });
    return ready;
}
