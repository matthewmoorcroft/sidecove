// Move to Space on a folder takes you with it, as it does for a single tab. `move` resolves to
// true only when the folder really moved, so a failed move leaves you in the space you were in.
export function followFolderMove({ move, switchTo }) {
    return async target => {
        if (await move(target.id)) await switchTo(target.id);
    };
}
