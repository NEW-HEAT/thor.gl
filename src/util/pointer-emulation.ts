/**
 * Cursor hide/show utilities.
 *
 * When hands are detected, the system cursor hides so the hand overlay
 * (rendered by ThorWidget) becomes the sole pointer.
 */

const STYLE_ID = "thor-gl-cursor-hide";

export function hideCursor(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = "* { cursor: none !important; }";
  document.head.appendChild(style);
}

export function showCursor(): void {
  document.getElementById(STYLE_ID)?.remove();
}
