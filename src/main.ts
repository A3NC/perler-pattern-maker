import './styles.css';

import { requireElement } from './dom';
import { fullImageCrop } from './lib/crop';
import { calculateDimensions } from './lib/pattern-utils';
import { loadPalette } from './palette';
import { generatePattern } from './pipeline/generate';
import { imageToPixels } from './rasterize';
import { clearPattern, initPatternViewControls, renderPattern, showProcessing } from './render/canvas-view';
import {
    clearCropPreview,
    getCrop,
    hideCropPreview,
    initCropControls,
    onCropChange,
    showCropPreview
} from './render/crop-view';
import { initEditorControls, setEditorPalette } from './render/editor';
import { ExportError, exportPatternPng } from './render/export-png';
import { initInventoryControls } from './render/inventory';
import { clearPatternState, getPatternState, onPatternChange, setPattern } from './state/pattern-state';
import { showStatus } from './status';
import { UploadError, readImageFile } from './upload';
import { exportFileName } from './lib/export-layout';
import type { CropRect } from './lib/crop';
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
const colorLimitInput = requireElement<HTMLInputElement>('colorLimit');
const statsDiv = requireElement('stats');
const dimensionsDiv = requireElement('dimensions');
const exportControls = requireElement('exportControls');
const exportBtn = requireElement<HTMLButtonElement>('exportBtn');

let perlerColors: Palette = [];
let paletteReady = false;
let uploadedImage: HTMLImageElement | null = null;

initPatternViewControls();
initInventoryControls();
initEditorControls();
initCropControls();

// The stats line reads the shared owner too, so an edit and a generate reach it
// by the same path and `Colors Used` cannot drift from the inventory (EDIT-4).
onPatternChange((state) => {
    if (!state) {
        statsDiv.textContent = '';
        return;
    }
    const distinctColors = Object.keys(state.tallies).length;
    statsDiv.textContent = `Pattern Size: ${state.pattern.width} x ${state.pattern.height} beads | `
        + `Total Beads Required: ${state.beadCount} | Colors Used: ${distinctColors}`;
});

// The export button exists exactly when a pattern does.
onPatternChange((state) => {
    exportControls.classList.toggle('is-active', state !== null);
});

// OUT-1 … OUT-3. Reads the shared owner at click time rather than holding a
// copy: the editor mutates that same Pattern in place, so whatever is on screen
// -- manual edits and undos included -- is what gets exported (OUT-2).
exportBtn.addEventListener('click', async () => {
    const state = getPatternState();
    if (!state) return;
    const { width, height } = state.pattern;

    exportBtn.disabled = true;
    showStatus('Exporting...', 'info');
    try {
        // Let the status line paint before the draw, which at the pixel budget
        // is a noticeable synchronous stretch.
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        await exportPatternPng(state.pattern);
        showStatus(`Pattern downloaded as ${exportFileName(width, height)}.`, 'success');
    } catch (error) {
        if (!(error instanceof ExportError)) console.error('Export failed:', error);
        showStatus((error as Error).message || 'The pattern could not be exported.', 'error');
    } finally {
        exportBtn.disabled = false;
    }
});

/**
 * One place decides what is interactive, rather than the three that used to
 * assign `generateBtn.disabled` between them, each knowing part of the story.
 *
 * Note what is *not* here: the size and colour settings stay live after a
 * pattern exists, so they can be changed and the pattern regenerated. Only the
 * crop is one-shot (D21).
 */
function syncControls(): void {
    generateBtn.disabled = !paletteReady || !uploadedImage;
    refreshDimensions();
}

/**
 * SET-3: the pattern the current crop and settings *would* produce, updated as
 * either changes. It stays live after a pattern exists, because the settings do
 * -- changing the width and watching this line is how the next generate is
 * aimed. It is labelled "Will generate" for that reason: once a pattern is on
 * screen the stats line below reports what *is*, and without the label the two
 * read as the same claim made twice.
 *
 * `calculateDimensions` throwing is the useful case rather than the awkward one:
 * it carries SET-5's message naming the limit that was hit, which until now
 * could only be seen by pressing Generate.
 */
function refreshDimensions(): void {
    if (!uploadedImage) {
        dimensionsDiv.textContent = '';
        dimensionsDiv.classList.remove('is-error');
        return;
    }

    const crop = currentCrop(uploadedImage);
    try {
        const { pixelWidth, pixelHeight, cellCount } = calculateDimensions(
            parseFloat(targetWidthInput.value),
            parseFloat(beadSizeSelect.value),
            crop.width,
            crop.height
        );
        dimensionsDiv.classList.remove('is-error');
        dimensionsDiv.textContent = `Will generate: ${pixelWidth} × ${pixelHeight} beads · `
            + `${cellCount.toLocaleString()} beads total`;
    } catch (error) {
        dimensionsDiv.classList.add('is-error');
        dimensionsDiv.textContent = (error as Error).message;
    }
}

/** The live crop, or the whole image before the preview has one. */
function currentCrop(image: HTMLImageElement): CropRect {
    return getCrop() ?? fullImageCrop(image.naturalWidth, image.naturalHeight);
}

targetWidthInput.addEventListener('input', refreshDimensions);
beadSizeSelect.addEventListener('change', refreshDimensions);
onCropChange(refreshDimensions);

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
        // The editor's color picker queries the same palette the pipeline
        // matches against, using the same OkLab table (EDIT-3).
        setEditorPalette(perlerColors);
        // SET-4's range is 2 to the palette size, and the palette size is not
        // known until now.
        colorLimitInput.max = String(perlerColors.length);
        generateBtn.textContent = 'Generate Pattern';
        syncControls();
        showStatus(`Default palette loaded (${perlerColors.length} colors). Upload an image to begin.`, 'success');
    })
    .catch((error: unknown) => {
        console.error('Error loading colors_221.json:', error);
        paletteReady = false;
        generateBtn.textContent = 'Palette unavailable';
        syncControls();
        // Name the actual failure (PAL-3). "Serve it over HTTP" is no longer the
        // right advice here: if the page were not served, the boot guard in
        // index.html would have caught it and this code would never have run.
        showStatus(
            `Unable to load the color palette: ${(error as Error).message || 'unknown error'}. `
            + 'Generation is disabled.',
            'error'
        );
    });

// Reading a file is asynchronous, so two quick picks can finish out of order
// and leave the older image installed. Each change claims a token and a stale
// result is dropped.
let uploadToken = 0;

imageUpload.addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Clear the input immediately. Without this, re-picking the file that was
    // just rejected fires no change event at all -- the value has not changed
    // -- so the app looks silently broken, which is the impression M3 exists
    // to remove. The File reference above stays valid once cleared.
    input.value = '';

    const token = ++uploadToken;
    showStatus(`Reading ${file.name}...`, 'info');

    try {
        const image = await readImageFile(file);
        if (token !== uploadToken) return;
        uploadedImage = image;
        // A new image brings the crop preview back -- it is the one thing that
        // does, since the crop is one-shot per image (D21) -- and it takes the
        // old pattern with it. Leaving that pattern up would leave a conversion
        // of an image no longer anywhere on screen: below the fold, looking
        // current, belonging to nothing.
        //
        // Only on success: a rejected file changed nothing, so it must not cost
        // the user the pattern they already had (M3).
        clearPattern();
        clearPatternState();
        showCropPreview(image);
    } catch (error) {
        if (token !== uploadToken) return;
        // **A rejected file changes nothing but the status line.** Not the
        // loaded image, not its crop, not the pattern.
        //
        // This revises M3, which cleared the loaded image and disabled Generate
        // after a rejection. That was right when it was written and is not now:
        // with no preview on screen, the user had no way to tell *which* image
        // was still loaded, so refusing to generate was the safe reading of an
        // ambiguous state. IN-5's preview removes the ambiguity -- whatever is
        // pictured is what will be generated -- and with it the reason. What is
        // left is a failed action that used to cost the user their loaded image,
        // their crop, and their way back to the preview.
        if (uploadedImage === null) clearCropPreview();
        // Every message from readImageFile names the actual problem
        // (IN-2 … IN-4, IN-6); anything else reaching here is a bug worth
        // seeing in the console.
        if (!(error instanceof UploadError)) console.error('Upload failed:', error);
        syncControls();
        showStatus((error as Error).message || 'That image could not be used.', 'error');
        return;
    }

    syncControls();
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

    const colorLimit = Number.parseInt(colorLimitInput.value, 10);
    if (!Number.isFinite(colorLimit) || colorLimit < 2 || colorLimit > perlerColors.length) {
        showStatus(
            `Enter a maximum color count between 2 and ${perlerColors.length}.`,
            'error'
        );
        return;
    }

    // The crop is the source of truth for size from here down -- never the
    // image's own dimensions, which describe the uncropped picture.
    const crop = currentCrop(uploadedImage);

    let dimensions;
    try {
        dimensions = calculateDimensions(
            parseFloat(targetWidthInput.value),
            parseFloat(beadSizeSelect.value),
            crop.width,
            crop.height
        );
    } catch (error) {
        showStatus((error as Error).message, 'error');
        return;
    }

    try {
        buildPattern(uploadedImage, crop, dimensions.pixelWidth, dimensions.pixelHeight, colorLimit);
        // D21, and only on the path where a pattern actually exists: the crop is
        // settled for this image. The size and colour settings stay live, so the
        // pattern can be regenerated at a different size without re-uploading;
        // only the framing is fixed. A new upload is what brings the crop back.
        hideCropPreview();
    } catch (error) {
        console.error('Pattern generation failed:', error);
        clearPattern();
        clearPatternState();
        showStatus((error as Error).message || 'Something went wrong while generating the pattern.', 'error');
    }
});

/** Rasterize, convert, then render the pattern, stats, and inventory. */
function buildPattern(
    image: HTMLImageElement,
    crop: CropRect,
    pixelWidth: number,
    pixelHeight: number,
    colorLimit: number
): void {
    showProcessing();

    const source = imageToPixels(image, pixelWidth, pixelHeight, crop);
    const { pattern, tallies } = generatePattern(source, perlerColors, {
        gridWidth: pixelWidth,
        gridHeight: pixelHeight,
        colorLimit
    });

    clearPattern();
    showStatus('Pattern generated successfully.', 'success');
    renderPattern(pattern);

    // One handoff, after the view exists: the stats line, the inventory, and the
    // editor all subscribe to this rather than each being pushed their own copy.
    setPattern(pattern, tallies);
}
