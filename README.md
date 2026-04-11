# thor.gl

[Mjolnir](https://github.com/visgl/mjolnir.js) for Humans. Hand, face, and pose gesture control for [deck.gl](https://deck.gl).

**[Live Demo](https://new-heat.github.io/thor.gl/)** | [RFC](https://github.com/NEW-HEAT/thor.gl/issues/1) | Built by [NEWHEAT](https://newheat.co)

## Demo

The live demo showcases all three output channels on a satellite globe with 20 pickable cities:

- **Navigation** — pinch-pan, pinch-zoom, pinch-rotate, pinch-pitch with hand gestures
- **Picking** — hover and click cities to select
- **Signals** — fist toggles globe/mercator, open-palm fires a toast notification

Toggle between **Mjolnir** (mouse/touch) and **Thor** (hand tracking) modes. Gesture cards on the right show live status with channel tags — click the checkbox to enable/disable any gesture at runtime.

Additional demo features: live camera feed with hand skeleton overlay (debug panel), collapsible event log, camera indicator, attention gate (experimental), and 9-point gaze calibration flow (experimental).

> Requires a webcam. For LAN access from another device: `HTTPS=1 npx vite --host`

To run locally:

```bash
cd demo
npm install
npx vite --host
```

## Quick start

### React hook

```tsx
import { useThor, setFistAction } from "thor.gl";

function MyMap() {
  const [viewState, setViewState] = useState(INITIAL_VIEW);

  setFistAction(() => console.log("fist!"));

  const { widgets } = useThor({
    setViewState,
    detector: "holistic",  // "hands" | "holistic" | "auto"
    enabled: true,
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
    panSensitivity: 5.0,
    panSmoothing: 0.4,
    panMoveDeadzone: 0.004,
    zoomSensitivity: 10,
    zoomDeadzone: 0.015,
    rotateSensitivity: 40,
    rotateDeadzone: 0.015,
    pitchSensitivity: 80,
    pitchDeadzone: 0.008,
    fistConfirmMs: 300,
    fistCooldownMs: 1500,
  },
});
```

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

- `@deck.gl/core` >= 9
- `@mediapipe/tasks-vision`
- `react` >= 18

## License

MIT
