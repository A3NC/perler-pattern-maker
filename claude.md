# Project Development Context

_Last reviewed: 2026-09-03_

## Project summary

This directory contains a client-side web application that converts an uploaded image into a Perler bead pattern. The user chooses a target physical width and bead size; the app calculates the required bead-grid dimensions, resizes the image, maps each visible pixel to the nearest color in a Perler palette, and displays an interactive pattern with bead codes and an inventory count.

The application is currently a functional single-page MVP. It has no build system, package manager dependencies, browser test harness, backend, persistence, or export workflow; deterministic Node tests cover reusable utility logic.

## Current repository contents

- `perler.html` — The complete application: HTML structure, inline CSS, and browser JavaScript.
- `colors_221.json` — The palette currently loaded by the app. It contains 221 records with `name`, `hex`, and precomputed `rgb` fields. This is currently the most common Perler bead color set used by the project.
- `colors.json` — A larger 291-record source palette containing `name` and `hex` only. It is not currently loaded by the app; it represents a more complete color set.
- `helper.py` — Small Python utility that converts a palette JSON file with hex colors into a new JSON file with added RGB tuples.
- `pattern-utils.mjs` — Dependency-free, browser-independent utility functions for palette normalization/validation, dimension validation, RGB matching, and inventory tallying.
- `pattern-utils.test.mjs` — Node's built-in test suite covering the deterministic pattern utility functions.
- `pixi.toml` — Minimal Pixi workspace metadata; it currently declares no dependencies or tasks.
- `.gitignore`, `.gitattributes` — Local Pixi and Git configuration.

There are no browser test files or source directories beyond the files listed above; deterministic Node tests are provided in `pattern-utils.test.mjs`.