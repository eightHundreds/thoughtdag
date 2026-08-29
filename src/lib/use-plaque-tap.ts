import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { isViewerMode } from './viewer';
import { SHEET_TAP_SLOP_PX, nodeDragEnabled } from './viewport-mode';
import { useViewportMode } from './use-viewport-mode';
import { usePublishedZoomTier } from './use-map-mode';

export function useNodeDrag(): boolean {
  const { sheet, coarse } = useViewportMode();
  return nodeDragEnabled({
    isViewer: isViewerMode,
    sheet,
    coarse,
    zoomTier: usePublishedZoomTier(),
  });
}

/** Grab class for map/work chrome. Empty when the node must pan the viewport. */
export function plaqueDragClass(nodesDraggable: boolean): string {
  return nodesDraggable ? 'drag-handle cursor-grab active:cursor-grabbing ' : '';
}

/** When nodes aren't draggable, distinguish a tap from a pan that started
 *  on the plaque. Callers should skip the regular onClick path while this
 *  is enabled — React Flow may still synthesize a click after a short pan. */
export function usePlaqueTap(onTap: () => void, enabled: boolean, slop = SHEET_TAP_SLOP_PX) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const pointers = useRef(0);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (!enabled || e.button !== 0) return;
      if (e.isPrimary) {
        pointers.current = 1;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        return;
      }
      pointers.current += 1;
      start.current = null;
    },
    onPointerUp: (e: ReactPointerEvent) => {
      if (pointers.current > 0) pointers.current -= 1;
      const origin = start.current;
      if (!enabled || !origin || e.pointerId !== origin.id) return;
      start.current = null;
      if (pointers.current > 0) return;
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < slop) onTap();
    },
    onPointerCancel: () => {
      pointers.current = 0;
      start.current = null;
    },
  };
}
