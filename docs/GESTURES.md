# thor.gl Gesture Catalog

## Related RFCs

- [NEW-HEAT/thor.gl#1](https://github.com/NEW-HEAT/thor.gl/issues/1) — Thor EventManager integration (three channels: NAV, PICK, SIGNAL)
- [visgl/deck.gl-community#594](https://github.com/visgl/deck.gl-community/pull/594) — AI-forward input drivers for editable-layers

## AI-Tool Bridge Pattern

thor.gl and editable-layers are orthogonal: neither imports the other.
The bridge is user code (a `useEffect`) that listens to thor signals and calls
`createEditTools().execute()`. Any other input channel — text/LLM via
`streamText({tools})`, voice via Whisper, another physical sensor — can drive
the same `createEditTools()` surface independently.

```ts
// Pattern: thor signal -> deck.unproject -> tools.execute()
thor.on('trigger', ({ screenPos }) => {
  const [lng, lat] = deck.unproject([screenPos.x, screenPos.y]);
  tools.draw_point.execute({ position: [lng, lat] });
});
```

---

## Gesture Table

| Gesture name | Pose | Emitted signal(s) | Semantics | Typical use |
|---|---|---|---|---|
| `pinch-pan` | Thumb + index pinched, drag | _(nav, no signal)_ | Continuous | Pan map |
| `pinch-zoom` | Both hands pinched, spread apart | _(nav)_ | Continuous | Zoom map |
| `pinch-rotate` | Both hands pinched, twist | _(nav)_ | Continuous | Rotate bearing |
| `pinch-pitch` | Both hands pinched, move up/down | _(nav)_ | Continuous | Tilt pitch |
| `open-palm` | All five fingers extended, spread | `openpalm` | Edge (rising) | Kill inertia |
| `fist` | All fingers curled, thumb over palm | `fist` | Edge (hold 300ms, fire on confirm) | Discrete action (toggle projection) |
| `fingergun` | Index + thumb up, middle/ring/pinky curled | `fingergun-aim` (continuous), `trigger` (edge) | Aim: continuous; fire: thumb-drop rising edge | Place point at aim location |
| `four-finger` | Index+middle+ring+pinky extended, thumb tucked | `eraser-move` (continuous), `eraser-end` (edge) | Active: continuous; release: single edge | Erase features under palm |

---

## Signal Payloads

All signals extend `HandSignalData`:
```ts
interface HandSignalData {
  hand?: 'Left' | 'Right';
  ts: number;  // frame timestamp (ms)
}
```

### `trigger`
```ts
{ screenPos: { x: number; y: number }; hand?; ts }
```
Fired once per trigger pull (thumb drops while fingergun pose is held).
`screenPos` is in deck canvas pixel space (mirror-corrected from MediaPipe).

### `fingergun-aim`
```ts
{ screenPos: { x: number; y: number }; hand?; ts }
```
Emitted every detection frame (~30 fps) while the fingergun pose is held.
Use this to drive a reticle overlay. `screenPos` tracks the index fingertip.

### `eraser-move`
```ts
{ center: { x: number; y: number }; radius: number; hand?; ts }
```
Emitted every frame while the four-finger eraser is held. `center` is the palm
center in canvas pixels; `radius` is the palm half-size in canvas pixels.
Use with `deck.pickObjects({ x, y, width, height })` to find features to delete.

### `eraser-end`
```ts
{ hand?; ts }
```
Fired once when the four-finger eraser pose deactivates.

### `fist`
```ts
{ hand?; ts }
```
Fired on rising edge after 300ms dwell. One signal per fist gesture.

### `openpalm`
```ts
{ hand?; ts }
```
Fired on rising edge when open-palm is detected.

---

## Canvas-Space Projection

MediaPipe landmarks are normalized [0,1] in video frame space. Thor reprojects
them to deck canvas pixels in `Thor._dispatchSignals` via `Thor.getCanvasPos()`.

Mirror correction: the camera preview is rendered mirrored (`ctx.scale(-1,1)`),
so `canvasX = (1 - landmark.x) * canvasWidth`. Y is not flipped.

To enable canvas-space signals, pass a canvas getter to `useThor`:

```ts
const { thor } = useThor({
  setViewState,
  canvas: () => deckRef.current?.deck?.getCanvas() ?? null,
});
```

Without `canvas`, the `trigger`, `fingergun-aim`, `eraser-move`, and `eraser-end`
signals are silently skipped. Navigation gestures (`pinch-*`, `fist`, `openpalm`)
are unaffected.

---

## Conflict Groups

Gesture handlers in the same group compete (higher priority wins).
Handlers in different groups coexist freely.

| Group | Handlers |
|---|---|
| `navigation` | pinch-pan, pinch-zoom |
| `rotation` | pinch-rotate |
| `pitch` | pinch-pitch |
| `signal` | open-palm |
| `action` | fist |
| `signal-aim` | fingergun |
| `signal-erase` | four-finger |

Fingergun and four-finger are in separate groups from all navigation gestures,
so they can be detected simultaneously with pinch-pan/zoom without conflict.
