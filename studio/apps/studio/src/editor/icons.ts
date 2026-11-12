import { svg } from "../dom";

/** Iconos de trazo (24×24, `currentColor`). Propios, sin dependencias. */
const PATHS = {
  pen: '<path d="M4 20l1-4L16.5 4.5a2 2 0 013 0l0 0a2 2 0 010 3L8 19z"/><path d="M14.5 6.5l3 3"/>',
  fill: '<path d="M5 14l7-9 7 7-7 8z"/><path d="M19 17c1 1.6 1.5 2.6 1.5 3.4a1.5 1.5 0 01-3 0c0-.8.5-1.8 1.5-3.4z" fill="currentColor"/>',
  eraser: '<path d="M3 16.5L13 5.5l7 6.5-6 7H8z"/><path d="M8 19h12"/><path d="M8.5 9.5l7 6.5"/>',
  select: '<rect x="3.5" y="3.5" width="12" height="12" stroke-dasharray="2.5 2.5"/><path d="M12 12l8 3-3.5 1.5L15 20z" fill="currentColor"/>',
  hand: '<path d="M9 12V6.5a1.5 1.5 0 013 0V11"/><path d="M12 11V5a1.5 1.5 0 013 0v6"/><path d="M15 11V6.5a1.5 1.5 0 013 0V14c0 4-2.5 7-6.5 7S6 18 5 15l-1.2-3.2a1.5 1.5 0 012.6-1.3L9 13"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 010 12" transform="translate(0 -4)"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 000 12" transform="translate(0 -4)"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  pause: '<rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/>',
  prev: '<path d="M16 5l-9 7 9 7z" fill="currentColor"/><path d="M5 5v14"/>',
  next: '<path d="M8 5l9 7-9 7z" fill="currentColor"/><path d="M19 5v14"/>',
  first: '<path d="M6 5v14"/><path d="M19 5l-10 7 10 7z" fill="currentColor"/>',
  last: '<path d="M18 5v14"/><path d="M5 5l10 7-10 7z" fill="currentColor"/>',
  loop: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 013-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 01-3 3H4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0112 6c6.4 0 10 6 10 6a17 17 0 01-3.2 3.8M6.5 7.6A17 17 0 002 12s3.6 7 10 7a10 10 0 004.3-1"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/>',
  up: '<path d="M6 14l6-6 6 6"/>',
  down: '<path d="M6 10l6 6 6-6"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/>',
  onion: '<circle cx="9" cy="12" r="6" stroke-dasharray="2 2.5"/><circle cx="15" cy="12" r="6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  brush: '<path d="M4 20c0-3 2-4 4-4a3 3 0 013 3c0 1-1 2-3 2z"/><path d="M10 15L20 5"/>',
  palette: '<path d="M12 3a9 9 0 100 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a3 3 0 003-3c0-5-3.5-9-8-9z"/><circle cx="8" cy="11" r="1" fill="currentColor"/><circle cx="12" cy="7.5" r="1" fill="currentColor"/><circle cx="16.5" cy="10" r="1" fill="currentColor"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 16.5l9 5 9-5"/>',
  flip: '<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M9 7L3 17h6z"/><path d="M15 7l6 10h-6z" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  bones: '<circle cx="6" cy="5" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="18" cy="19" r="2.2"/><path d="M7.6 6.7l3 3.6M13.6 13.7l3 3.6"/><path d="M12 12l5-4" stroke-dasharray="2 2"/>',
  diamond: '<path d="M12 3l8 9-8 9-8-9z" fill="currentColor"/>',
  eyeBone: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><path d="M10 10l4 4"/>',
  export: '<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M4 14v5a2 2 0 002 2h12a2 2 0 002-2v-5"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/>',
  person: '<circle cx="12" cy="7" r="3.2"/><path d="M5 21c0-4.5 3-7.5 7-7.5s7 3 7 7.5"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 22): SVGElement {
  const el = svg(
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`,
  );
  return el;
}
