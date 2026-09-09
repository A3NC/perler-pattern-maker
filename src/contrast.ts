/**
 * Black or white text for a given cell color, by relative luminance (VIEW-4).
 * Lives outside the view because M1's canvas and M6's export both need it.
 */
export function getContrastColor(r: number, g: number, b: number): string {
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
}
