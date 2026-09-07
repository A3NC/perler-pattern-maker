# Purpose
To create a webapp that generates perler bead patterns that resemble pixel art from images.

## Who and why

- Who: For perler bead creators with images they want to make art of. Mostly young, trendy people who enjoy crafts.

- Why: Only pixel art can be made with perler beads, not continuous images. Turning images into pixel art allows the users to customize and create whatever they like, instead of relying on pre-existing pixel art patterns.

## Non-goals
- This is not a mobile app.
- It should not include a forum or any social functions where users interact with each other.
- The users should not be able to share patterns with others directly through the website.
- It only generates patterns from uploaded images. It does not generate AI images. It may edit or enhance the source image, but all of its output originates from the source image itself.

## Core scenarios

- 

## Must / Should / Won't

- Must: Accept images, and throw readable errors when encountering corrupted images or non-images. Allow users to set the desired size of the finished product. Output a pixel art pattern according to the image and size. The pattern must include the code for each color. The pattern should be human-readable, allowing the user to zoom in and out.

- Should: Allow the user to export patterns that they have created. Have a drawing interface where users can make edits to the pattern they have created. Allow the user to choose between different color palettes provided by different perler bead sets.

- Won't: Will not let the users to send private messages to other users. 

## Done looks like



## Constraints and hunches

## Open Questions

- Is it designed to mostly run locally or be hosted on a website?

## Decision log