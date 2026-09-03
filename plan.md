1. UI: Create a clean interface where users can upload an image.

2. Inputs: Add a field for the user to input their desired final physical width in inches.

3. Logic: A standard Perler bead is 0.197 inches, but the user should be able to choose between 5mm and 2mm beads. Calculate the required pixel width (Target Inches / Bead Size). Maintain the image's original aspect ratio to calculate the height.

4. Image Processing: Resize the uploaded image to the new pixel dimensions.

5. Color Quantization: Convert every pixel to the nearest available Perler bead color (in colors.json) using Euclidean distance in RGB.

6. Output: Display the result as a zoomable pixel grid. On top of each pixel, render the specific Perler bead code so the user knows which bead to place.