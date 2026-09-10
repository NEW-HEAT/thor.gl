# thor.gl demo — September 2026

## Run

Requires Node 22.12+ (or 20.19+) and a webcam.

```sh
cd demo
npm ci
npm run dev -- --host 127.0.0.1 --port 5178
```

Open http://127.0.0.1:5178 and choose **Start camera**. The mirrored camera feed appears behind the globe by default. Model loading and permission requests have their own status; a failed or timed-out start offers **Retry camera** and **Use mouse & touch**.

On another device, use a trusted HTTPS origin. `HTTPS=1 npm run dev -- --host` enables local HTTPS, but the device must trust its certificate before camera access works.

## Rehearse

1. Start camera and allow permission. Keep both hands in frame with even lighting.
2. Pinch thumb and index finger on one hand, then drag to move the globe.
3. Pinch both hands; move apart/together to zoom, twist to rotate, move up/down to tilt.
4. Open a palm to stop motion and pan inertia. Hold a fist briefly to switch globe/map.
5. **Pause motion** freezes navigation while the video and landmarks remain live. Mouse and touch still work.
6. **Background** shows/hides the camera image without disabling tracking. The status says **Camera hidden** when hidden.
7. **Controls → Stop camera & tracking** releases the camera completely.

Controls includes sensitivity, inertia duration, individual gesture switches, landmark visibility, camera opacity, and globe/map selection. Tuning does not reload the detector or reacquire the camera. Reset returns to the opening globe view and clears gesture momentum.

Release a drag or hand pinch to coast. Inertia defaults to 0.9 seconds and can be adjusted from 0 to 1.6 seconds in Controls. A new pinch catches hand momentum immediately; a stationary hold before release does not fling. The default is off when the browser requests reduced motion.

Keyboard: **Space** pauses/resumes (when focus is on the globe), **R** resets, **C** toggles the camera background, **Escape** closes controls and pauses motion. Native button/input keyboard behavior is preserved.

The interface keeps the globe and controls visible without a logo, headline, or byline.

## Validation on September 10

- **PASS:** Fresh lockfile installation (`npm ci --ignore-scripts`) in an isolated temporary directory.
- **PASS:** TypeScript checks across the demo and library; 26 regression tests; production build.
- **PASS:** Local browser rendered the globe, a real camera behind it, aligned hand landmarks, and live hand/gesture status. Rotate, move, and open-palm states were observed. Individual gesture usability is still something to rehearse with the presenter.
- **PASS:** Rendered mouse drag continued moving after release and settled; the Inertia slider switched to Off.
- **PASS:** Pause/resume UI, camera background toggle, sensitivity adjustment, per-gesture switch, globe/map buttons, and stop-camera flow. After stop, only the background video remained in the DOM with `srcObject: null`.
- **PASS:** Desktop 1280×720 and mobile 390×844 layout checks. Mobile viewport geometry was read back after resize; this is browser viewport testing, not physical-phone proof.
- **PASS:** Unit regressions cover slow motion below per-frame deadzones, reacquisition after hand loss, stable hand ordering, GPU-to-CPU fallback, open-palm stopping, single-fire fist actions, startup failure/timeout, late camera/model cleanup, landmark overlay reattachment after restart, and frame-rate-independent release momentum.
- **UNVERIFIED:** Venue/projector, the demo device's permission setup, and final presenter acceptance. Public thor.gl has not been deployed by this change.

## Dependencies and remaining limits

- deck.gl and luma.gl 9.4.0; MediaPipe Tasks Vision 1.0.1; React 19.3; Vite 8.2.2; TypeScript 7.0.2.
- MediaPipe WASM and model assets are fetched at startup; imagery comes from Esri. Load once on the demo network and rehearse before presenting. Camera frames are processed locally and are not uploaded or recorded.
- Polar regions beyond the satellite tile latitude limit use a plain colored cap, not satellite imagery.
- The initial install included unused ArcGIS SDK dependencies through the umbrella `deck.gl` package. The demo now imports only the individual deck.gl modules it uses.
- npm audit still reports transitive findings through loaders.gl's archive/texture tooling (fflate and image-size). npm's suggested geo-layers downgrade would undo the requested 9.4 upgrade; no forced downgrade or incompatible transitive override was applied. This demo does not accept uploaded archives or run texture compression.
- Experimental face/gaze/pose exports remain in the library, outside the hand-focused demo. The gesture registry/configuration is still shared within a page; use one active Thor instance per page.
