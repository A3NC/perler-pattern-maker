import { requireElement } from '../dom';
import { getPatternState, onPatternChange } from '../state/pattern-state';
import type { ColorTally } from '../types';

const container = requireElement('beadCountsContainer');
const listElement = requireElement('beadList');
const sortSelect = requireElement<HTMLSelectElement>('sortOption');

/**
 * Tier 1 of the color picker (EDIT-3): the colors already in the pattern.
 * Rather than build a second swatch-and-code list beside this one, the
 * inventory itself is the picker -- clicking a row makes that color active,
 * which adds nothing to the shopping list by construction and covers the
 * dominant correction ("make this cell match the one next to it").
 */
let selectedName: string | null = null;
let selectHandler: ((tally: ColorTally) => void) | null = null;

export function onBeadSelect(handler: (tally: ColorTally) => void): void {
    selectHandler = handler;
}

/** Mark which row is the active color. Re-renders; the list is at most SET-4 rows. */
export function setSelectedBead(name: string | null): void {
    if (selectedName === name) return;
    selectedName = name;
    renderBeadCounts();
}

/** Render the bead inventory in the selected sort order (OUT-4). */
function renderBeadCounts(): void {
    const state = getPatternState();
    const counts = state ? Object.values(state.tallies) : [];

    if (counts.length === 0) {
        container.style.display = 'none';
        listElement.innerHTML = '';
        return;
    }

    container.style.display = 'block';
    listElement.innerHTML = '';

    // Clone so the incoming order (row-major first-appearance, which breaks
    // ties under a stable sort) is never mutated.
    const sortedCounts = [...counts];
    if (sortSelect.value === 'count') {
        sortedCounts.sort((a, b) => b.count - a.count);
    } else {
        sortedCounts.sort((a, b) => a.name.localeCompare(b.name));
    }

    sortedCounts.forEach((item) => {
        // A real button, not a div with a click listener: it is a control now,
        // so it should be reachable by keyboard and announced as one. The
        // global `button` rule is overridden in .bead-list, not here (UI-3).
        const row = document.createElement('button');
        row.type = 'button';
        row.className = item.name === selectedName ? 'bead-item selected' : 'bead-item';
        row.setAttribute('aria-pressed', String(item.name === selectedName));
        row.title = `Use ${item.name} as the active color`;

        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = `rgb(${item.rgb[0]}, ${item.rgb[1]}, ${item.rgb[2]})`;

        const nameLabel = document.createElement('span');
        nameLabel.className = 'color-name';
        nameLabel.textContent = item.name;

        const countBadge = document.createElement('span');
        countBadge.className = 'color-count';
        countBadge.textContent = String(item.count);

        row.appendChild(swatch);
        row.appendChild(nameLabel);
        row.appendChild(countBadge);
        row.addEventListener('click', () => selectHandler?.(item));

        listElement.appendChild(row);
    });
}

export function initInventoryControls(): void {
    sortSelect.addEventListener('change', renderBeadCounts);
    // The inventory reads the shared owner rather than being pushed a copy, so
    // an edit updates it through exactly the same path a generate does (EDIT-4).
    onPatternChange(() => renderBeadCounts());
}
