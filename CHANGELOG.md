# Changelog

## 0.2.0 — 2026-09-10

- Replace satellite raster tiles with a bundled Natural Earth vector atlas, including polar geometry, country selection, and country labels.
- Preserve globe size when panning toward the poles. Map hand movement through deck.gl's native navigation math, including tilted flat maps.
- Make pinch pickup faster, retain movement during grab confirmation, reduce filtering delay, and prevent stale positions from carrying into a new grab.
- Bound release glide, cancel it on tracking loss, and let mouse/touch navigation take control cleanly.
- Simplify the website to an immersive globe and compact controls, with camera background toggle, zoom buttons, mobile fitting, and optional advanced gestures.
- Upgrade to deck.gl/luma.gl 9.4.0 and MediaPipe Tasks Vision 1.0.1. Improve camera startup, retry, timeout, GPU fallback, and cleanup.

### For contributors

- Keep demo installation smaller by removing unused raster-layer dependencies. Add regression coverage for navigation, gesture momentum, atlas geometry, and camera lifecycle.
