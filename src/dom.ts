/** Look up a required element once, loudly. Replaces scattered null-unsafe lookups. */
export function requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing required element: #${id}`);
    return element as T;
}
