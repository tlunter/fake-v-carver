# Fake V-Carver

A browser-based SVG pre-processing tool for the [Shaper Origin](https://www.shapertools.com/) CNC router.

Upload an SVG file, select paths, configure your V-bit, and the tool generates a series of concentric inner-offset paths that simulate the passes a V-bit router makes during V-carving. Each generated path is encoded with the `shaper:cutDepth` attribute so the file can be loaded directly into Shaper Origin without manual depth configuration.

## What it does

- Drag-and-drop or click to upload any SVG file
- Automatically detects and respects Shaper Origin color encoding (guide, exterior, interior, online, anchor, pocket)
- Renders an interactive preview with pan and zoom
- ⌘-click (macOS) or Ctrl-click (Windows/Linux) to select/deselect paths
- Computes inward offset rings using V-bit geometry (angle + bit diameter)
- Live preview with pass color coding (cyan = shallow, orange = deep)
- Toggle between design preview and Shaper-accurate color encoding preview
- Exports a clean, pretty-printed SVG with grouped offset paths and correct `shaper:cutDepth` attributes

## Tech stack

- React + TypeScript + Vite
- Tailwind CSS
- Clipper.js for polygon offset math

## Development

```bash
npm install
npm run dev
```

## About

This project was generated using [Claude](https://claude.ai) (claude-sonnet-4-6) via [OpenCode](https://opencode.ai). The implementation was built iteratively through conversation, including the SVG parsing, V-bit geometry math, Clipper.js offset pipeline, pan/zoom canvas, and Shaper Origin color encoding support.
