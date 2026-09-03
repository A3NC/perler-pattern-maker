## TODO

- Currently, if an image with a white background is uploaded, the white background would be counted as beads, while usually users would want to only make the image itself. Add function to remove background from image. It would maybe be best to do this before the image gets resized, so that the borders don't get blurry. Also test how the program responds to transparent backgrounds.

- Make UI look better (more thoughtful color schemes and fonts, less-techy), catering to the aesthetic of young, alternative-style people who are into perler beads. Options to switch between themes, if time and readability permits.

- Change the image drawing algorithm

    - More algorithms: Reference this site under "pixel art scaling algorithms" https://lospec.com/pixel-art-scaler/
    - Option to toggle between algorithms.
    - Find some way so that it is able to process actual pixel art, not images to pixel art - the "pixel art" uploaded might not be actual pixels but larger images consisting of squares, which is usually what you get when you download pixel art from the internet

- Add function for auto-border: automatically draws a border around the image.

- Add toggle to switch between original image and pattern.

- Add functionality so that the user can draw on the canvas, after the image has been generated. The user can draw with any color, but it will automatically be scaled to the closest perler bead color once the pixel has been drawn. There should be a 1-pixel brushstroke button, an eraser button, a color-picker button, and a drag button, as well as color box to choose the color to draw in, similar to a drawing app. 

- *Longer Term Goal* Add another homepage that demonstrates how the site works, then a button to go to the maker. Options to save and load patterns that the user has made.

### Already Done
- Toggle to show and hide perler bead codes (DONE)

- Count how many beads of each color is needed. (DONE)

- Zoom window behaves weird with large images. It cannot scroll, and when zooming out the image is not centered. Fix this. (DONE)

## MEMO

### Intro

Perler beads are small, hollow plastic beads that you arrange on a pegged grid and fuse together with a household iron to make pixel art. The program addresses the problem of how we can turn images into pixel patterns for perler beads that uses the specific set of colors available in a perler bead set. It also summarizes the amount and color of beads used in a project, so that the user can purchase the corresponding materials.

This project is a client-side single-page application that generates physical Perler bead craft patterns from uploaded images.

It takes an input image, downscales it to target physical dimensions using non-smoothed Canvas API operations, and quantizes the raw pixel data by mapping each pixel to the nearest matching color in a pre-scraped Perler RGB dataset via 3D Euclidean distance calculations.

The app then dynamically renders an interactive, CSS Grid-based layout complete with CSS matrix scaling, viewport-aware scroll centering, a visual bead code overlay, and a real-time sorted inventory list of required color counts.


### August 30

#### Core Goals Achieved

**1. Clean UI & Image Upload**
* Built a modern, centralized UI using CSS variables and a responsive card layout.
* Implemented a file upload input that cleanly accepts and reads local image files using the HTML5 `FileReader` API.

**2. Physical Dimension Inputs**
* Added a numeric input field allowing users to specify their exact desired physical width in inches.

**3. Bead Size Logic & Aspect Ratio**
* Added a dropdown selection for bead types: **Standard (5mm / ~0.197 inches)** and **Mini (2mm / ~0.079 inches)**.
* Implemented the mathematical logic to divide the target inches by the bead size to get the exact pixel width.
* Automatically calculated the required pixel height to perfectly maintain the uploaded image's original aspect ratio.

**4. Image Processing & Resizing**
* Utilized an invisible HTML5 `<canvas>` element to mathematically downscale the uploaded image to the newly calculated pixel dimensions. 
* Upgraded the standard scaling method to prevent the browser from muddying the colors with anti-aliasing. 

**5. Color Quantization**
* Successfully linked an external JSON file containing 200+ accurate Perler bead colors (fetched dynamically via a local Python server).
* Implemented a Euclidean distance algorithm in 3D RGB color space to perfectly map every single pixel in the scaled image to the closest available physical Perler bead.
* Introduced **Floyd-Steinberg Dithering** to intelligently distribute color-matching errors across adjacent pixels, preserving smooth color gradients instead of creating harsh, banded edges.

**6. Output & Zoomable Grid**
* Generated a CSS Grid layout where each cell represents a physical bead.
* Rendered the specific Perler bead code directly on top of each pixel.
* Added dynamic text contrast logic so the bead code is always readable (white text on dark beads, black text on light beads).

---

#### Bonus Enhancements Implemented

While solving the core requirements, we also implemented the following quality-of-life improvements:

* **Smart Zoom Engine:** Built a custom zoom algorithm that dynamically scales the grid while locking the viewport height. It accurately tracks the center of the user's screen during zooming without breaking scrollbars or cutting off large patterns.
* **Toggleable Text Codes:** Added a UI checkbox and CSS class toggle allowing users to instantly hide or show the text codes on the pixels to view the pure pattern.
* **Bead Inventory Generator:** Created a scrolling, dynamic inventory list below the pattern that tallies exactly how many beads of each color are required. 
* **Inventory Sorting:** Added a dropdown allowing users to sort the required bead list either alphabetically by color name, or quantitatively by the largest bead count. 

### Next Steps Available
The core application is fully operational. If you wish to continue development, the immediate next step would be wrapping the Image Processing algorithms (Nearest-Neighbor vs. Dithering vs. Area Averaging) into a UI dropdown so users can dynamically choose the best rendering method based on the specific type of image they upload.