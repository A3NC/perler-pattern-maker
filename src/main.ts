import './styles.css';

import { requireElement } from './dom';
import { fullImageCrop } from './lib/crop';
import type { SavedSettings } from './lib/pattern-save';
import { calculateDimensions, tallyPattern } from './lib/pattern-utils';
import { loadPalette } from './palette';
import { countBeads, generatePattern } from './pipeline/generate';
import { imageToPixels } from './rasterize';
import { clearPattern, initPatternViewControls, renderPattern, showProcessing } from './render/canvas-view';
import {
    clearCropPreview,
    getCrop,
    hideCropPreview,
    initCropControls,
    onCropChange,
    restoreCropPreview,
    showCropPreview
} from './render/crop-view';
import { initEditorControls, setEditorPalette } from './render/editor';
import { initAutosave, loadSavedSession } from './state/autosave';
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
/** The file `uploadedImage` was decoded from, kept for the autosave (D23). */
let uploadedFile: File | null = null;

initPatternViewControls();
initInventoryControls();
initEditorControls();
initCropControls();

// SAVE-1: mirrors the pattern, its settings and the image it came from into
// IndexedDB. Read at each generate, so the image saved is the one on screen.
initAutosave(() => (uploadedImage && uploadedFile
    ? { file: uploadedFile, crop: currentCrop(uploadedImage) }
    : null));

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
 * either changes.
 *
 * **Shown only while it says something the screen does not** (D24). Once a
 * pattern exists, the stats line reports what *is*; this line stays hidden
 * until the target width or bead size stops matching the settings that produced
 * that pattern, i.e. until the next Generate would come out a different size.
 * That is derived from the settings `pattern-state.ts` already holds rather
 * than from a flag each handler would have to remember to set, so a restore,
 * a failed generate, and a width changed and changed back all come out right
 * without a case of their own. The maximum colours do not bring it back: they
 * change neither the size nor the bead count.
 *
 * The total is **beads**, not cells: transparent cells are left empty by the
 * pipeline and so are not billed, and the count comes from the same
 * rasterization and the same coverage math a generate would use, so it equals
 * the "Total Beads Required" the stats line shows afterwards.
 *
 * `calculateDimensions` throwing is the useful case rather than the awkward one:
 * it carries SET-5's message naming the limit that was hit, which until now
 * could only be seen by pressing Generate. It is always shown: it is about the
 * settings, and settings over the limit never produced a pattern to match.
 */
function renderDimensions(): void {
    if (!uploadedImage) {
        showDimensions('', false);
        return;
    }

    const crop = currentCrop(uploadedImage);
    const targetWidth = parseFloat(targetWidthInput.value);
    const beadSize = parseFloat(beadSizeSelect.value);
    let dimensions;
    try {
        dimensions = calculateDimensions(targetWidth, beadSize, crop.width, crop.height);
    } catch (error) {
        showDimensions((error as Error).message, true);
        return;
    }

    const generated = getPatternState()?.settings;
    if (generated && generated.targetWidth === targetWidth && generated.beadSize === beadSize) {
        showDimensions('', false);
        return;
    }

    const { pixelWidth, pixelHeight } = dimensions;
    let text = `Will generate: ${pixelWidth} × ${pixelHeight} beads`;
    try {
        const beads = beadCountFor(uploadedImage, crop, pixelWidth, pixelHeight);
        text += ` · ${beads.toLocaleString()} beads total`;
    } catch (error) {
        // The dimensions are still right; a count that cannot be computed is
        // left off rather than guessed at as width x height.
        console.error('Bead count failed:', error);
    }
    showDimensions(text, false);
}

function showDimensions(text: string, isError: boolean): void {
    dimensionsDiv.textContent = text;
    dimensionsDiv.classList.toggle('is-error', isError);
}

/** The last count, since the same crop and grid are asked for repeatedly (a restore, syncControls). */
let beadCountCache: { image: HTMLImageElement; key: string; beads: number } | null = null;

/**
 * The beads a generate would bill at this crop and grid: the same
 * `imageToPixels` call `buildPattern` makes, then only the coverage half of the
 * downsample. The buffer is bounded by the grid size (SUPERSAMPLE per side), so
 * this is cheap at ordinary sizes and costs one rasterization near the limit.
 */
function beadCountFor(image: HTMLImageElement, crop: CropRect, gridWidth: number, gridHeight: number): number {
    const key = `${crop.x},${crop.y},${crop.width},${crop.height}:${gridWidth}x${gridHeight}`;
    if (beadCountCache?.image === image && beadCountCache.key === key) return beadCountCache.beads;

    const beads = countBeads(imageToPixels(image, gridWidth, gridHeight, crop), gridWidth, gridHeight);
    beadCountCache = { image, key, beads };
    return beads;
}

/**
 * Coalesce refreshes to one per frame. A crop drag or a held arrow key fires
 * far more often than the screen repaints, and near the size limit each
 * refresh rasterizes; one per frame still reads as immediate (SET-3's Check).
 */
let dimensionsFrame = 0;

function refreshDimensions(): void {
    if (dimensionsFrame) return;
    dimensionsFrame = requestAnimationFrame(() => {
        dimensionsFrame = 0;
        renderDimensions();
    });
}

/** The live crop, or the whole image before the preview has one. */
function currentCrop(image: HTMLImageElement): CropRect {
    return getCrop() ?? fullImageCrop(image.naturalWidth, image.naturalHeight);
}

targetWidthInput.addEventListener('input', refreshDimensions);
beadSizeSelect.addEventListener('change', refreshDimensions);
onCropChange(refreshDimensions);
// A generate hides the line and a cleared pattern brings it back (D24).
onPatternChange(() => refreshDimensions());

// Startup wiring succeeded, so the boot guard in index.html can stand down and
// leave the status line to us. Deliberately set here rather than at the top of
// the file: if an import or a requireElement lookup above throws, the flag
// stays unset and the guard reports the failure that would otherwise be
// invisible. The palette load below reports itself through showStatus.
window.__perlerBooted = true;

// Load and validate the default palette before enabling generation (PAL-2, PAL-3).
// The restore waits for it to settle either way: the editor resolves its
// opening color and the inventory's picks through the loaded palette, and the
// restore's status line has to come after the palette's rather than be
// overwritten by it.
const paletteSettled = loadPalette()
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

// Every upload and restore claims a token; see below.
paletteSettled.then(() => restoreSavedSession());

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
        uploadedFile = file;
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

    // Captured here, with the pattern, because the inputs stay editable after
    // a generate (D21) and so cannot be read back later as this pattern's
    // settings (D23).
    const settings: SavedSettings = {
        targetWidth: parseFloat(targetWidthInput.value),
        beadSize: parseFloat(beadSizeSelect.value),
        colorLimit
    };

    let dimensions;
    try {
        dimensions = calculateDimensions(settings.targetWidth, settings.beadSize, crop.width, crop.height);
    } catch (error) {
        showStatus((error as Error).message, 'error');
        return;
    }

    try {
        buildPattern(uploadedImage, crop, dimensions.pixelWidth, dimensions.pixelHeight, settings);
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
    settings: SavedSettings
): void {
    showProcessing();

    const source = imageToPixels(image, pixelWidth, pixelHeight, crop);
    const { pattern, tallies } = generatePattern(source, perlerColors, {
        gridWidth: pixelWidth,
        gridHeight: pixelHeight,
        colorLimit: settings.colorLimit
    });

    clearPattern();
    showStatus('Pattern generated successfully.', 'success');
    renderPattern(pattern);

    // One handoff, after the view exists: the stats line, the inventory, and the
    // editor all subscribe to this rather than each being pushed their own copy.
    setPattern(pattern, tallies, settings);
}

/**
 * SAVE-1: put back the last session (D23). The pattern is the part that
 * matters -- it is the hand-edited work -- so an image that cannot be restored
 * costs only the ability to regenerate without re-uploading, never the pattern.
 *
 * The image is decoded *before* the pattern is installed, because installing
 * it fires the autosave's 'set', which rewrites the slot from whatever image is
 * loaded at that moment. Done in this order, the rewrite puts back what was
 * read (and drops an image that failed), rather than deleting a good image
 * because it had not finished decoding yet.
 *
 * Never throws: `__perlerBooted` is already set, so nothing above would report it.
 */
async function restoreSavedSession(): Promise<void> {
    // Claims a token like an upload does, so an upload started while a large
    // saved image is still decoding wins, and nothing flickers back over it.
    const token = ++uploadToken;

    try {
        const session = await loadSavedSession();
        if (token !== uploadToken) return;

        if (session.kind === 'invalid') {
            console.warn('Saved pattern discarded:', session.reason);
            showStatus('Your last pattern could not be restored, so the page has started fresh.', 'error');
            return;
        }
        if (session.kind === 'none') return;

        let image: HTMLImageElement | null = null;
        let imageProblem = session.imageProblem;
        if (session.image) {
            try {
                image = await readImageFile(session.image.file);
            } catch (error) {
                imageProblem = (error as Error).message;
            }
            if (token !== uploadToken) return;
        }
        if (imageProblem) console.warn('Saved image not restored:', imageProblem);

        if (image && session.image) {
            uploadedImage = image;
            uploadedFile = session.image.file;
            restoreCropPreview(image, session.image.crop);
            // The crop was settled for this image when the pattern was generated (D21).
            hideCropPreview();
        }

        applySettings(session.settings);

        clearPattern();
        renderPattern(session.pattern);
        setPattern(session.pattern, tallyPattern(session.pattern), session.settings);
        syncControls();

        const { width, height } = session.pattern;
        let message = `Restored your last pattern (${width} × ${height} beads, saved ${formatSavedAt(session.savedAt)}).`;
        if (!image) {
            message += ' Its source image could not be restored, so upload it again to regenerate.';
        }
        if (!paletteReady) {
            message += ' The color palette could not be loaded, so generation is disabled.';
        }
        showStatus(message, image && paletteReady ? 'success' : 'info');
    } catch (error) {
        console.error('Restore failed:', error);
        if (token !== uploadToken) return;
        clearPattern();
        clearPatternState();
        showStatus('Your last pattern could not be restored, so the page has started fresh.', 'error');
    }
}

/** Put a restored pattern's settings back in the inputs, skipping any the page cannot show. */
function applySettings(settings: SavedSettings): void {
    targetWidthInput.value = String(settings.targetWidth);
    colorLimitInput.value = String(settings.colorLimit);
    const option = Array.from(beadSizeSelect.options)
        .find((candidate) => parseFloat(candidate.value) === settings.beadSize);
    if (option) beadSizeSelect.value = option.value;
}

function formatSavedAt(iso: string): string {
    const saved = new Date(iso);
    if (Number.isNaN(saved.getTime())) return 'earlier';
    const sameDay = saved.toDateString() === new Date().toDateString();
    return sameDay
        ? `at ${saved.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : saved.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
