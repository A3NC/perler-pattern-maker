import { requireElement } from '../dom';
import type { ColorTally } from '../types';

const container = requireElement('beadCountsContainer');
const listElement = requireElement('beadList');
const sortSelect = requireElement<HTMLSelectElement>('sortOption');

let currentCounts: ColorTally[] = [];

export function setBeadCounts(counts: ColorTally[]): void {
    currentCounts = counts;
}

/** Render the bead inventory in the selected sort order (OUT-4). */
export function renderBeadCounts(): void {
    if (currentCounts.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    listElement.innerHTML = '';

    // Clone so the incoming order (row-major first-appearance, which breaks
    // ties under a stable sort) is never mutated.
    const sortedCounts = [...currentCounts];
    if (sortSelect.value === 'count') {
        sortedCounts.sort((a, b) => b.count - a.count);
    } else {
        sortedCounts.sort((a, b) => a.name.localeCompare(b.name));
    }

    sortedCounts.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'bead-item';

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

        listElement.appendChild(row);
    });
}

export function initInventoryControls(): void {
    sortSelect.addEventListener('change', renderBeadCounts);
}
