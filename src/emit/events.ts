/**
 * PICK_EVENT_TO_CALLBACK — maps a pick event type string to the deck.gl layer/deck
 * callback prop name that should be invoked when the event fires.
 */

export const PICK_EVENT_TO_CALLBACK: Record<string, string> = {
  gazemove: 'onGaze',
  handpoint: 'onHandPoint',
  grab: 'onGrab',
  hover: 'onHover',
  click: 'onClick',
  dragstart: 'onDragStart',
  drag: 'onDrag',
  dragend: 'onDragEnd',
};
