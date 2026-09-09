import { getContrastColor } from '../contrast';
import { requireElement } from '../dom';
import type { Pattern } from '../types';

// M0-ONLY. This is the element-per-bead grid with CSS-transform zoom that D1
// rules out: it collapses well below the NFR-3 caps and cannot support per-cell
// painting. M1 deletes this file and replaces it with a canvas view, so resist
// improving anything in here.

const outputContainer = requireElement('outputContainer');
const zoomControls = requireElement('zoomControls');
const toggleTextBtn = requireElement<HTMLInputElement>('toggleTextBtn');

let currentZoom = 1;
let baseGridWidth = 0;
let baseGridHeight = 0;

export function showProcessing(): void {
    outputContainer.innerHTML = 'Processing...';
}

export function clearPattern(): void {
    outputContainer.innerHTML = '';
}

/** Build the bead grid and show it at 1x, centered. */
export function renderPattern(pattern: Pattern): void {
    const grid = document.createElement('div');
    grid.id = 'pattern-grid';
    grid.style.gridTemplateColumns = `repeat(${pattern.width}, 30px)`;

    for (const cell of pattern.cells) {
        const pixel = document.createElement('div');
        pixel.className = 'pixel';

        if (!cell) {
            pixel.style.backgroundColor = 'transparent';
        } else {
            const [r, g, b] = cell.rgb;
            pixel.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
            pixel.style.color = getContrastColor(r, g, b);
            pixel.textContent = cell.name;
        }

        grid.appendChild(pixel);
    }

    // The wrapper resizes with the scaled grid, which is what keeps the
    // scrollbars honest.
    const wrapper = document.createElement('div');
    wrapper.id = 'grid-wrapper';
    wrapper.appendChild(grid);
    outputContainer.appendChild(wrapper);

    // Must be measured AFTER insertion -- reading these before the grid is in
    // the document yields 0, and zoom then silently collapses to scale(0).
    baseGridWidth = grid.scrollWidth;
    baseGridHeight = grid.scrollHeight;

    zoomControls.style.display = 'flex';
    applyZoom(1);

    // Center the scrollbars on the newly generated pattern.
    outputContainer.scrollLeft = (wrapper.offsetWidth - outputContainer.clientWidth) / 2;
    outputContainer.scrollTop = (wrapper.offsetHeight - outputContainer.clientHeight) / 2;
}

/** Rescale the grid, keeping the viewport center fixed (VIEW-2). */
export function applyZoom(newZoom: number): void {
    const wrapper = document.getElementById('grid-wrapper');
    const grid = document.getElementById('pattern-grid');
    if (!wrapper || !grid) return;

    const centerX = outputContainer.scrollLeft + (outputContainer.clientWidth / 2);
    const centerY = outputContainer.scrollTop + (outputContainer.clientHeight / 2);

    const currentScaledWidth = baseGridWidth * currentZoom;
    const currentScaledHeight = baseGridHeight * currentZoom;
    const ratioX = currentScaledWidth > 0 ? centerX / currentScaledWidth : 0.5;
    const ratioY = currentScaledHeight > 0 ? centerY / currentScaledHeight : 0.5;

    currentZoom = newZoom;
    const newScaledWidth = baseGridWidth * currentZoom;
    const newScaledHeight = baseGridHeight * currentZoom;

    grid.style.transform = `scale(${currentZoom})`;
    wrapper.style.width = `${newScaledWidth}px`;
    wrapper.style.height = `${newScaledHeight}px`;

    outputContainer.scrollLeft = (ratioX * newScaledWidth) - (outputContainer.clientWidth / 2);
    outputContainer.scrollTop = (ratioY * newScaledHeight) - (outputContainer.clientHeight / 2);
}

export function initPatternViewControls(): void {
    requireElement('zoomInBtn').addEventListener('click', () => applyZoom(currentZoom + 0.2));
    // Floor at 20%.
    requireElement('zoomOutBtn').addEventListener('click', () => applyZoom(Math.max(0.2, currentZoom - 0.2)));

    toggleTextBtn.addEventListener('change', () => {
        const grid = document.getElementById('pattern-grid');
        if (!grid) return;
        grid.classList.toggle('hide-text', !toggleTextBtn.checked);
    });
}
