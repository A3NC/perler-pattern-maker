# Purpose
To create a webapp that generates perler bead patterns that resemble pixel art from images.

## Who and why

- Who: For perler bead creators with images they want to make art of. Mostly young, trendy people who enjoy crafts.

- Why: Only pixel art can be made with perler beads, not continuous images. Turning images into pixel art allows the users to customize and create whatever they like, instead of relying on pre-existing pixel art patterns.

## Non-goals
- This is a webapp, not a mobile app.
- Users should not be able to DM each other.
- Users cannot post patterns publicly on the website.
- It only generates patterns from uploaded images. It does not generate images based on text. It may edit or enhance the source image, but all of its output originates from the source image itself.

## Core scenarios

- As a pixel artist, I know how to draw pixel art, but I don't know what perler bead color is closest to each pixel. I just want a drawing interface so that I can draw as usual, but the colors turn into the closest colors I have in my perler bead set.

- As an amateur perler maker, I want to make perler bead art from a picture of my dog. I want a pattern of good pixel art generated from the image, so that it tells me which colors to use and how to arrange them in order to make physical art of a specifed size.

- 

## Must / Should / Won't

- Must: 
    - Before pattern generation: Accept images, and throw readable errors when encountering corrupted images or non-images. Allow users to set the desired size of the finished product. Allow users to choose the size of the perler beads that they are using (2mm vs 5mm). Allow users to choose the perler bead color palette that they are working with. After the image is uploaded, show a preview of the image and allow the user to crop it before hitting generate.
    - During pattern generation: Output a pixel art pattern according to the image, size, and palette. The pixel art should be artistic and true to the original image. The pattern must include the code for each color. The color codes should be able to be toggled on and off for a better viewing experience. The UI displaying the pattern should be human-readable, allowing the user to zoom in and out.
    - After pattern generation: Show the amount and colors of the perler beads needed. Allow the user to export patterns that they have created.

- Should: 
    - Before pattern generation: Have an optional advanced settings option that includes:
        - Whether to remove backgrounds. Default: Remove
        If this option is checked, remove continuous solid color backgrounds from the image.
        - Whether the image input is already pixel art or not. Default: Not pixel art
        If this option is checked, ignore the size parameter and generate a pixel-by-pixel pattern without resizing. Include a safety check that errors out if the input image is too large.
        - Algorithm toggle. Default: *Best performing algorithm that will be determined in the future*
        Generate the pattern using the resizing algorithm chosen in this option.
    - During pattern generation: Have a drawing interface where users can make edits to the pattern that has been generated. The interface should include a one-cell brush, eraser, color picker, and drag/pan tool.
    - After pattern generation: Cache drafts that the user has been working on. The user should be able to return to projects that they started earlier. 

- Won't: Will not use generic resizing algorithms that makes the pixel art look blurry. Will not currently include a login function or a homepage, but might happen in the future. Will not include options for users to post patterns publicly.

## Done looks like

Success criteria: Satisfy all the constraints in the Must/Should/Won't section.

## Constraints and hunches

## Open Questions

- Is it designed to mostly run locally or be hosted on a website?

## Decision log