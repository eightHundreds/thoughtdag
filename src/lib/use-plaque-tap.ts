import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { SHEET_TAP_SLOP_PX } from './viewport-mode';

/** Grab class for map/work chrome. Empty when the node must pan the viewport. */
export function plaqueDragClass(nodesDraggable: boolean): string {
  return nodesDraggable ? 'drag-handle cursor-grab active:cursor-grabbing ' : '';
}

/** When nodes aren't draggable, distinguish a tap from a pan that started
 *  on the plaque. Callers should skip the regular onClick path while this
 *  is enabled — React Flow may still synthesize a click after a short pan. */
export function usePlaqueTap(onTap: () => void, enabled: boolean) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (!enabled || e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: ReactPointerEvent) => {
      if (!enabled || !start.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      start.current = null;
      if (Math.hypot(dx, dy) < SHEET_TAP_SLOP_PX) onTap();
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}
