// Where Arc keeps its sidebar file, as short steps for the system the person is on. Pure: the
// panel passes in chrome.runtime.getPlatformInfo().os.
export const MAC_PATH = '~/Library/Application Support/Arc/StorableSidebar.json';
export const WINDOWS_PATH = '%LOCALAPPDATA%\\Packages';

const MAC = {
    system: 'mac',
    label: 'On a Mac',
    intro: 'In the file window, press Command-Shift-G and paste:',
    path: MAC_PATH
};
const WINDOWS = {
    system: 'win',
    label: 'On Windows',
    intro: 'In the file window’s address bar, paste:',
    path: WINDOWS_PATH,
    after: 'Open the folder that starts with TheBrowserCompany.Arc, then LocalCache\\Local\\Arc.'
};

// Arc runs on Mac and Windows only. On any other system (or when the system is not known) both
// are shown, Mac first, as the file may have been copied from either.
export function locationSteps(os) {
    if (os === 'mac') return [MAC];
    if (os === 'win') return [WINDOWS];
    return [MAC, WINDOWS];
}
