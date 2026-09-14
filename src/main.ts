import './styles.css';

import { requireElement } from './dom';
import { calculateDimensions } from './lib/pattern-utils';
import { loadPalette } from './palette';
import { generatePattern } from './pipeline/generate';
import { imageToPixels } from './rasterize';
import { clearPattern, initPatternViewControls, renderPattern, showProcessing } from './render/canvas-view';
import { initInventoryControls, renderBeadCounts, setBeadCounts } from './render/inventory';
import { showStatus } from './status';
import { readImageFile } from './upload';
import type { Palette } from './types';

declare global {
    interface Window {
        /** Set at the end of startup; read by the boot guard in index.html. */
        __perlerBooted?: boolean;
    }
}

const imageUpload = requireElement<HTMLInputElement>('imageUpload');
const generateBtn = requireElement<HTMLButtonElement>('generateBtn');
const targetWidthInput = requireElement<HTMLInputElement>('targetWidth');
const beadSizeSelect = requireElement<HTMLSelectElement>('beadSize');
const statsDiv = requireElement('stats');

let perlerColors: Palette = [];
let paletteReady = false;
let uploadedImage: HTMLImageElement | null = null;

initPatternViewControls();
initInventoryControls();

// Startup wiring succeeded, so the boot guard in index.html can stand down and
// leave the status line to us. Deliberately set here rather than at the top of
// the file: if an import or a requireElement lookup above throws, the flag
// stays unset and the guard reports the failure that would otherwise be
// invisible. The palette load below reports itself through showStatus.
window.__perlerBooted = true;

// Load and validate the default palette before enabling generation (PAL-2, PAL-3).
loadPalette()
    .then((palette) => {
        perlerColors = palette;
        paletteReady = true;
        generateBtn.disabled = !uploadedImage;
        generateBtn.textContent = 'Generate Pattern';
        showStatus(`Default palette loaded (${perlerColors.length} colors). Upload an image to begin.`, 'success');
    })
    .catch((error: unknown) => {
        console.error('Error loading colors_221.json:', error);
        paletteReady = false;
        generateBtn.disabled = true;
        generateBtn.textContent = 'Palette unavailable';
        // Name the actual failure (PAL-3). "Serve it over HTTP" is no longer the
        // right advice here: if the page were not served, the boot guard in
        // index.html would have caught it and this code would never have run.
        showStatus(
            `Unable to load the color palette: ${(error as Error).message || 'unknown error'}. `
            + 'Generation is disabled.',
            'error'
        );
    });

imageUpload.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
        uploadedImage = await readImageFile(file);
    } catch (error) {
        uploadedImage = null;
        generateBtn.disabled = true;
        showStatus((error as Error).message, 'error');
        return;
    }

    generateBtn.disabled = !paletteReady;
    showStatus(
        paletteReady
            ? 'Image ready. Choose dimensions and generate your pattern.'
            : 'Image ready; waiting for the color palette to finish loading.',
        paletteReady ? 'success' : 'info'
    );
});

generateBtn.addEventListener('click', () => {
    if (!uploadedImage) {
        showStatus('Upload an image before generating a pattern.', 'error');
        return;
    }
    if (!paletteReady || perlerColors.length === 0) {
        showStatus('The color palette is not ready yet. Please wait and try again.', 'error');
        return;
    }

    let dimensions;
    try {
        dimensions = calculateDimensions(
            parseFloat(targetWidthInput.value),
            parseFloat(beadSizeSelect.value),
            uploadedImage.width,
            uploadedImage.height
        );
    } catch (error) {
        showStatus((error as Error).message, 'error');
        return;
    }

    try {
        buildPattern(uploadedImage, dimensions.pixelWidth, dimensions.pixelHeight);
    } catch (error) {
        console.error('Pattern generation failed:', error);
        clearPattern();
        showStatus((error as Error).message || 'Something went wrong while generating the pattern.', 'error');
    }
});

/** Rasterize, convert, then render the pattern, stats, and inventory. */
function buildPattern(image: HTMLImageElement, pixelWidth: number, pixelHeight: number): void {
    showProcessing();

    const source = imageToPixels(image, pixelWidth, pixelHeight);
    const { pattern, tallies, beadCount } = generatePattern(source, perlerColors);

    clearPattern();
    showStatus('Pattern generated successfully.', 'success');
    renderPattern(pattern);

    statsDiv.textContent = `Pattern Size: ${pixelWidth} x ${pixelHeight} beads | Total Beads Required: ${beadCount}`;

    setBeadCounts(Object.values(tallies));
    renderBeadCounts();
}
