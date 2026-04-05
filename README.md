# thor.gl

[Mjolnir](https://github.com/visgl/mjolnir.js) for Humans. Hand, face, and pose gesture control for [deck.gl](https://deck.gl).

**[Live Demo](https://new-heat.github.io/thor.gl/)** | Built by [NEWHEAT](https://newheat.co)

## Quick start

```tsx
import { useThor, setFistAction } from "thor.gl";

function MyMap() {
  const [viewState, setViewState] = useState(INITIAL_VIEW);

  const { widgets } = useThor({
    setViewState,
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

## Built-in gestures

| Gesture | Input | Effect | Group |
|---|---|---|---|
| `pinch-pan` | Pinch + drag (1 hand) | Pan longitude/latitude | navigation |
| `pinch-zoom` | Pinch (2 hands) apart/together | Zoom in/out | navigation |
| `pinch-rotate` | Pinch (2 hands) + twist | Rotate bearing | rotation |
| `pinch-pitch` | Pinch (2 hands) + move up/down | Tilt pitch | pitch |
| `open-palm` | Open palm | Signal / stop inertia | signal |
| `fist` | Closed fist (hold 300ms) | Fire action callback | action |

## Configuration

All gesture parameters have defaults and can be overridden via `useThor`:

```tsx
const { widgets } = useThor({
  setViewState,
  config: {
    // Global detection
    minConfidence: 0.5,     // hand detection confidence floor
    grabDelay: 100,         // ms pinch must be held to confirm
    pinchThreshold: 0.06,   // thumb-index distance for pinch

    // Pan
    panSensitivity: 5.0,
    panSmoothing: 0.4,      // low-pass filter (0-1, higher = smoother)
    panMoveDeadzone: 0.004, // ignore jitter below this

    // Zoom
    zoomSensitivity: 10,
    zoomDeadzone: 0.015,

    // Rotate
    rotateSensitivity: 40,
    rotateDeadzone: 0.015,  // radians

    // Pitch
    pitchSensitivity: 80,
    pitchDeadzone: 0.008,

    // Fist
    fistConfirmMs: 300,     // hold duration before firing
    fistCooldownMs: 1500,   // cooldown between fires
  },
});
```

## Custom gestures

Implement `GestureHandler` and register it:

```ts
import { registerGesture, type GestureHandler } from "thor.gl";

const myGesture: GestureHandler = {
  name: "thumbs-up",
  requires: ["hands"],

  detect(frame) {
    // Return { gesture: "thumbs-up", data: { ... } } or null
  },

  apply(detection, viewState, config) {
    // Return modified viewState (or same reference for no change)
    return viewState;
  },

  // Optional lifecycle
  onActivate() {},
  onDeactivate() {},
  reset() {},
};

registerGesture(myGesture, { priority: 15, group: "signal" });
```

### Conflict resolution

Gestures in the **same group** compete — highest priority wins. Gestures in **different groups** coexist. This lets pan + fist fire simultaneously while pan and zoom resolve within "navigation".

## Architecture

```
Camera  -->  MediaPipe HandLandmarker  -->  ThorFrame
                                               |
                    GestureHandler.detect()  <--+
                           |
                    resolveConflicts()
                           |
                    GestureHandler.apply()  -->  ViewState delta
                           |
                    ThorWidget.render()     -->  Canvas overlay
```

- **Detection** (`src/detection/`) — MediaPipe wrapper. Auto-promotes from HandLandmarker to HolisticLandmarker when face/pose gestures are registered.
- **Gestures** (`src/gestures/`) — Registry of `GestureHandler` implementations. Each handler owns its own detect/apply lifecycle.
- **Engine** (`src/engine.ts`) — Frame loop at ~30fps. Fans out to handlers, resolves conflicts, merges viewState, notifies widget.
- **Widget** (`src/ThorWidget.ts`) — deck.gl Widget that renders fingertip dots, pinch cursors, and mode indicators on a mirrored canvas overlay.
- **Hook** (`src/useThor.ts`) — React hook that wires it all together. Returns a stable `widgets` array for DeckGL.

## Demo

A standalone demo app lives in `demo/`. To run it:

```bash
cd demo
npm install
npm run dev
```

This starts a Vite dev server with a satellite globe you can control with hand gestures.

## Peer dependencies

- `@deck.gl/core` >= 9
- `@mediapipe/tasks-vision`
- `react` >= 18

## License

MIT
