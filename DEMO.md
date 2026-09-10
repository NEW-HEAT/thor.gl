# thor.gl demo — September 2026

## Run

Requires Node 22.12+ (or 20.19+) and a webcam.

```sh
cd demo
npm ci
npm run dev -- --host 127.0.0.1 --port 5178
```

Open http://127.0.0.1:5178 and choose **Use hands**. The mirrored camera feed appears behind the globe by default. Model loading and permission requests have their own status; a failed or timed-out start offers **Retry camera** and **Use mouse & touch**.

On another device, use a trusted HTTPS origin. `HTTPS=1 npm run dev -- --host` enables local HTTPS, but the device must trust its certificate before camera access works.

## Rehearse

1. Choose **Use hands** and allow permission. Keep both hands in frame with even lighting.
2. Pinch thumb and index finger on one hand, then drag to move the globe.
3. Pinch both hands and move apart/together to zoom.
4. Open a palm to stop motion and pan inertia. **Controls** has Globe / Flat map buttons. Twist, tilt, and fist-to-switch are optional gestures, off by default.
5. **Pause motion** freezes navigation while the video and landmarks remain live. Mouse and touch still work.
6. **Background** shows/hides the camera image without disabling tracking. The status says **Camera hidden** when hidden.
7. **Controls → Stop camera & tracking** releases the camera completely.

Controls includes hand sensitivity, glide, individual gesture switches, landmark visibility, camera opacity, and globe/map selection. Tuning does not reload the detector or reacquire the camera. Reset returns to the opening globe view and clears gesture momentum.

Release a drag or a visible hand pinch to coast. Hand glide defaults to 280 ms and can be adjusted from 0 to 600 ms. Pointer glide uses 60% of that duration, with globe pointer travel capped at 24 px. A new pinch catches hand momentum immediately; a stationary hold, tracking loss, or low-confidence release does not fling. Hand release runs at display refresh rate and cancels if camera samples go stale. The default is off when the browser requests reduced motion.

The demo confirms a grab after 35 ms, retains movement during that confirmation, and uses a 12 ms positional filter with a small slack region to reject tremor. Hand panning uses deck.gl’s native controller state, with half the displayed camera movement at 1× sensitivity. This accounts for camera cropping, bearing, pitch, and globe latitude correction. Panning toward the poles preserves the globe’s apparent size. Zoom uses the ratio of hand spacing: at 1× sensitivity, 25% wider spacing produces approximately 25% more magnification, regardless of the initial span. Large single-frame tracking jumps rebase without moving the globe. Mouse dragging temporarily takes control from hand tracking; new hand updates discard old pointer transition settings.

Keyboard: **Space** pauses/resumes (when focus is on the globe), **R** resets, **C** toggles the camera background, **Escape** closes controls and pauses motion. Native button/input keyboard behavior is preserved.

The interface keeps the globe and controls visible without a logo, headline, or byline.

## Validation on September 10

- **PASS:** Fresh lockfile installation (`npm ci --ignore-scripts`) in an isolated temporary directory.
- **PASS:** TypeScript checks across the demo and library; 45 regression tests; production build.
- **PASS:** Local browser rendered the globe, a real camera behind it, aligned hand landmarks, and live hand/gesture status. Rotate, move, and open-palm states were observed. Individual gesture usability is still something to rehearse with the presenter.
- **PASS:** Replayed a quick 100 px mouse drag in the built browser preview before and after tuning. The previous release spun across a hemisphere; the bounded controller produced a small glide and remained settled in the next screenshot. Controller regressions separately verify the extreme-velocity cap and zero-inertia behavior.
- **PASS:** Pause/resume UI, camera background toggle, sensitivity adjustment, per-gesture switch, globe/map buttons, and stop-camera flow. After stop, only the background video remained in the DOM with `srcObject: null`.
- **PASS:** Desktop 1280×720 and mobile 390×844 layout checks. Mobile viewport geometry was read back after resize; this is browser viewport testing, not physical-phone proof.
- **PASS:** Unit regressions cover slow motion below per-frame deadzones, reacquisition after hand loss, stable hand ordering, GPU-to-CPU fallback, open-palm stopping, single-fire fist actions, startup failure/timeout, late camera/model cleanup, landmark overlay reattachment after restart, and frame-rate-independent release momentum.
- **PASS:** Vector atlas rendered with country borders, decluttered labels, complete polar coverage, and stable globe size during a mouse drag toward the Arctic. The opening globe fits the 390×844 browser viewport.
- **UNVERIFIED:** Venue/projector, the demo device’s permission setup, and final presenter acceptance. Release deployment is tracked by the GitHub Pages workflow.

## Dependencies and remaining limits

- deck.gl and luma.gl 9.4.0; MediaPipe Tasks Vision 1.0.1; React 19.3; Vite 8.2.2; TypeScript 7.0.2.
- The Natural Earth 1:50m country atlas is bundled with the website, including polar geometry. It supports world and regional exploration, with visible zoom bounded to 0–6; it is not a street map. Country labels appear as you zoom in. See [data attribution](demo/public/data/README.md).
- MediaPipe WASM and model assets are fetched at startup. Load once on the demo network and rehearse before presenting. Camera frames are processed locally and are not uploaded or recorded.
- The initial install included unused ArcGIS SDK dependencies through the umbrella `deck.gl` package. The demo now imports only the individual deck.gl modules it uses.
- Removing the unused raster-layer package also removed its archive/texture tooling dependencies. The September 10 demo dependency installation reported zero audit findings.
- Experimental face/gaze/pose exports remain in the library, outside the hand-focused demo. The gesture registry/configuration is still shared within a page; use one active Thor instance per page.
