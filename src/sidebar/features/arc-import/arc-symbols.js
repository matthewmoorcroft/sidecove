// Arc names its space symbols after Apple's SF Symbols ("person.2.fill"); these are the
// Sidecove symbols that show the same thing. A name is tried whole, then without its last
// part, so "star.fill" finds "star". Anything else imports without an icon.
const ARC_SYMBOLS = {
    house: 'house',
    home: 'house',
    briefcase: 'briefcase',
    case: 'briefcase',
    music: 'eighth-notes',
    'music.note': 'eighth-notes',
    book: 'book-open',
    books: 'book-open',
    airplane: 'plane',
    plane: 'plane',
    wallet: 'wallet',
    creditcard: 'wallet',
    wrench: 'wrench',
    hammer: 'wrench',
    camera: 'camera',
    photo: 'camera',
    gamecontroller: 'gamepad-2',
    fork: 'chef-hat',
    'fork.knife': 'chef-hat',
    dumbbell: 'dumbbell',
    figure: 'dumbbell',
    paintpalette: 'palette',
    paintbrush: 'palette',
    lightbulb: 'lightbulb',
    flask: 'flask-conical',
    testtube: 'flask-conical',
    leaf: 'leaf',
    tree: 'sprout',
    'camera.macro': 'sprout',
    star: 'star',
    sparkles: 'star',
    heart: 'heart',
    flame: 'flame',
    fire: 'flame',
    rocket: 'rocket',
    graduationcap: 'graduation-cap',
    cart: 'shopping-cart',
    bag: 'shopping-cart',
    newspaper: 'newspaper',
    folder: 'folder',
    pawprint: 'paw-print',
    globe: 'globe',
    planet: 'orbit',
    person: 'users',
    people: 'users',
    'person.2': 'users',
    'person.3': 'users',
    'chevron.left.forwardslash.chevron.right': 'code',
    curlybraces: 'code',
    terminal: 'terminal',
    cup: 'coffee',
    mug: 'coffee',
    mountain: 'mountain',
    sun: 'sun',
    'sun.max': 'sun',
    moon: 'moon',
    cloud: 'cloud',
    bolt: 'zap',
    bookmark: 'bookmark',
    calendar: 'calendar',
    envelope: 'mail',
    message: 'message-circle',
    bubble: 'message-circle',
    film: 'film',
    tv: 'tv',
    car: 'car',
    bicycle: 'bike',
    building: 'building',
    'building.2': 'building',
    'building.columns': 'landmark',
    shield: 'shield',
    flag: 'flag',
    gift: 'gift',
    trophy: 'trophy',
    pencil: 'pen-tool',
    brain: 'brain',
    headphones: 'headphones',
    mappin: 'map-pin',
    map: 'map-pin',
    stethoscope: 'heart-pulse',
    chart: 'chart-line'
};

// The Sidecove symbol name for an Arc symbol name, or null.
export function sidecoveSymbolFor(arcName) {
    let parts = String(arcName ?? '')
        .trim()
        .toLowerCase()
        .split('.')
        .filter(Boolean);
    while (parts.length) {
        const name = parts.join('.');
        if (Object.hasOwn(ARC_SYMBOLS, name)) return ARC_SYMBOLS[name];
        parts = parts.slice(0, -1);
    }
    return null;
}

export const ARC_SYMBOL_TARGETS = [...new Set(Object.values(ARC_SYMBOLS))];
