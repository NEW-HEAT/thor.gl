# thor.gl

[Mjolnir](https://github.com/visgl/mjolnir.js) for Humans. Hand, face, and pose gesture control for [deck.gl](https://deck.gl).

**[Live Demo](https://thor.gl)** | [RFC](https://github.com/NEW-HEAT/thor.gl/issues/1) | Built by [NEWHEAT](https://newheat.co)

## Demo

The demo uses **deck.gl 9.4** and **MediaPipe Tasks Vision 1.0.1**. Explore a vector atlas of countries and coastlines, or choose **Use hands** for a mirrored live camera background and hand navigation. Country geometry follows the globe directly, including the poles, without raster tiles.

- Pinch one hand to grab and move; pinch both to zoom. Open a palm to stop.
- Enable optional twist, tilt, and fist-to-switch gestures in **Controls**.
- Pause motion, show/hide the camera background, or stop the camera completely.
- Tune sensitivity, release inertia, individual gestures, landmarks, and camera visibility in **Controls**.
- Mouse/touch navigation, zoom buttons, and country/city picking stay available throughout.

The bundled Natural Earth atlas is designed for world and regional exploration (zoom 0–6), with country names appearing as you zoom in. Panning preserves the globe's apparent size at high latitudes. The opening view fits narrow screens.

The default UI is a compact control dock. Camera permission, model loading, errors, and retries have visible states. Camera frames stay on the device; the camera and tracking model are shared by the background and controls.

See [DEMO.md](DEMO.md) for the rehearsal guide and the current validation boundaries, [CHANGELOG.md](CHANGELOG.md) for release notes, and [atlas attribution](demo/public/data/README.md) for the bundled data source.

```bash
cd demo
npm ci
npm run dev
```

Requires Node 22.12+ or 20.19+, and HTTPS or localhost for camera access.

## Quick start

### React hook

```tsx
import { useThor, setFistAction } from "thor.gl";

function MyMap() {
  const [viewState, setViewState] = useState(INITIAL_VIEW);

  setFistAction(() => console.log("fist!"));

  const { widgets, status, error, video, retry } = useThor({
    setViewState,
    detector: "hands",  // "hands" | "holistic" | "auto"
    enabled: true,
    paused: false, // pause navigation while keeping camera and landmarks live
  });

  return (
    <DeckGL
      viewState={viewState}
      widgets={widgets}
      onViewStateChange={({ viewState: vs }) => setViewState(vs)}
    />
  );
}
```

`status` is `idle`, `camera`, `model`, `running`, or `error`; `error` holds a startup or tracking failure, and `retry()` restarts the session. `video` exposes the shared camera element for a background. Set `cameraOverlay: true` to align landmarks with a background using `object-fit: cover`, or `showOverlay: false` to hide landmarks. Changing `config`, `gestures`, or `paused` keeps the current camera session; setting `enabled: false` stops it.

### Thor class (framework-agnostic)

```ts
import { Thor } from "thor.gl";

const thor = new Thor(deck, { hand: true, face: true });

thor.on("fist", () => console.log("fist!"));
thor.on("gesture:activate", (e) => console.log(e.gesture));

await thor.start();
```

## Gestures

### Active (hand tracking)

| Gesture | Input | Effect | Channel |
|---|---|---|---|
| `pinch-pan` | Pinch + drag (1 hand) | Pan longitude/latitude | NAV |
| `pinch-zoom` | Pinch (2 hands) apart/together | Zoom in/out | NAV |
| `pinch-rotate` | Pinch (2 hands) + twist | Rotate bearing | NAV |
| `pinch-pitch` | Pinch (2 hands) + move up/down | Tilt pitch | NAV |
| `open-palm` | Open palm | Signal / stop inertia | SIGNAL |
| `fist` | Closed fist (hold 300ms) | Fire action callback | SIGNAL |

### Experimental (opt-in, requires holistic mode)

| Gesture | Input | Status | Issue |
|---|---|---|---|
| `gaze` | Iris + head pose tracking | Needs better calibration model | [#3](https://github.com/NEW-HEAT/thor.gl/issues/3) |
| `blink` | Deliberate blink (150-800ms) | Works, depends on gaze for targeting | |
| `head-tilt` | Head rotation | Too flakey for navigation | |
| `lean` | Body lean via pose skeleton | Too flakey for navigation | |

Register experimental gestures manually:

```ts
import { registerGesture, gaze, blink, headTilt, lean } from "thor.gl";

registerGesture(gaze, { priority: 10, group: "gaze" });
registerGesture(blink, { priority: 12, group: "action" });
```

## Three output channels

Thor routes gesture detections through three channels:

```
Camera -> MediaPipe -> Thor Engine -> detect + recognize
    |
    +-- NAVIGATION --- gestures emit standard mjolnir events -----> Controller -> ViewState
    |                  (panmove, pinchmove, wheel)                  works with any controller
    |
    +-- PICKING ------ gestures call deck.pickObject() -----------> layer callbacks
    |                  (onGaze, onHandPoint, onGrab)                works with any pickable layer
    |
    +-- SIGNALS ------ discrete gesture events -------------------> application callbacks
                       (fist, blink, openpalm, wave)                thor.on('fist', handler)
```

## Configuration

```tsx
const { widgets } = useThor({
  setViewState,
  config: {
    minConfidence: 0.5,
    grabDelay: 100,
    pinchThreshold: 0.06,
    panSensitivity: 1.6,
    panSmoothing: 0.4,
    inertiaDuration: 280, // milliseconds, capped at 600; 0 disables hand momentum
    panMoveDeadzone: 0.004,
    zoomSensitivity: 1, // multiplier of log2(hand span ratio)
    zoomDeadzone: 0.008,
    minZoom: 0,
    rotateSensitivity: 40,
    rotateDeadzone: 0.015,
    pitchSensitivity: 80,
    pitchDeadzone: 0.008,
    fistConfirmMs: 300,
    fistCooldownMs: 1500,
  },
});
```

These are library defaults. The demo uses a 35 ms grab confirmation and a smaller pan deadzone for prompt pickup. Its optional `panViewState(viewState, {dx, dy}, sensitivity)` hook callback maps normalized camera movement through deck.gl's native controller state, accounting for the mirrored camera, viewport, bearing, pitch, and globe latitude correction. See [demo/navigation.ts](demo/navigation.ts) and its wiring in [demo/App.tsx](demo/App.tsx). The demo sets `minZoom: -6` to allow deck.gl's negative polar zoom correction while bounding the visible zoom range separately.

## Custom gestures

```ts
import { registerGesture, type GestureHandler } from "thor.gl";

const myGesture: GestureHandler = {
  name: "thumbs-up",
  requires: ["hands"],
  detect(frame) {
    // Return { gesture: "thumbs-up", data: { ... } } or null
  },
  apply(detection, viewState, config) {
    return viewState; // signal-only, no nav effect
  },
};

registerGesture(myGesture, { priority: 15, group: "signal" });
```

Gestures in the **same group** compete (highest priority wins). Different groups coexist.

## Architecture

```
Camera  -->  MediaPipe (Hand / Holistic)  -->  ThorFrame
                                                  |
                       GestureHandler.detect()  <-+
                              |
                       resolveConflicts()
                              |
                  +-----------+-----------+
                  |           |           |
              Navigation   Picking     Signals
              emit/nav.ts  emit/pick   emit/signals
                  |           |           |
              EventManager  pickObject  callbacks
                  |           |           |
              Controller   Layer props  thor.on()
```

- **Detection** (`src/detection/`) — MediaPipe wrapper. Auto-promotes to holistic when face/pose gestures register.
- **Gestures** (`src/gestures/`) — Registry of `GestureHandler` implementations with conflict resolution.
- **Emit** (`src/emit/`) — Translation layer: navigation events, picking calls, signal dispatch.
- **Thor** (`src/thor.ts`) — Framework-agnostic class wiring all three channels to a deck instance.
- **Engine** (`src/engine.ts`) — Frame loop at ~30fps.
- **Widget** (`src/ThorWidget.ts`) — deck.gl Widget for hand/body visualization overlay.
- **Hook** (`src/useThor.ts`) — React hook wrapping the engine + widget.

## Peer dependencies

- `@deck.gl/core` ^9.4.0
- `@mediapipe/tasks-vision` ^1.0.1
- `react` >= 18

## License

MIT
