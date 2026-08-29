import type { ThoughtNode } from '../types';
import { isThoughtCard } from './content';
import { clampMapLandingZoom, worldAtScreenCenter } from './viewport-mode';

/** The camera only needs viewport fit/center — keep this loose so App's
 *  typed ReactFlowInstance<ThoughtNode, ThoughtEdge> assigns cleanly. */
export type CameraFlow = {
  fitView: (opts?: { padding?: number; duration?: number }) => Promise<boolean> | boolean | void;
  getViewport: () => { x: number; y: number; zoom: number };
  setCenter: (x: number, y: number, opts?: { zoom?: number; duration?: number }) => Promise<boolean> | boolean | void;
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
};

export function oldestThoughtNode(nodes: ThoughtNode[]): ThoughtNode | undefined {
  const thoughts = nodes.filter((n) => isThoughtCard(n.data.stepKind));
  if (thoughts.length === 0) return undefined;
  return [...thoughts].sort((a, b) =>
    (a.data.createdAt ?? '').localeCompare(b.data.createdAt ?? ''),
  )[0];
}

let gen = 0;

/** Fit the graph, then clamp into the map band. Callers must not also set
 *  the uncontrolled `fitView` prop. Overlapping calls cancel the older one. */
export async function landCompactCamera(
  rf: CameraFlow,
  nodes: ThoughtNode[],
): Promise<void> {
  const mine = ++gen;
  if (nodes.length === 0) return;
  await rf.fitView({ padding: 0.15, duration: 0 });
  if (mine !== gen) return;
  const { zoom } = rf.getViewport();
  const next = clampMapLandingZoom(zoom, window.innerWidth);
  if (!next.recenterThought && next.zoom === zoom) return;
  if (next.recenterThought) {
    const n = oldestThoughtNode(nodes);
    if (n) {
      await rf.setCenter(n.position.x + 260, n.position.y + 110, {
        zoom: next.zoom,
        duration: 300,
      });
      return;
    }
  }
  if (mine !== gen) return;
  const flowCenter = worldAtScreenCenter(
    (p) => rf.screenToFlowPosition(p),
    { width: window.innerWidth, height: window.innerHeight },
  );
  await rf.setCenter(flowCenter.x, flowCenter.y, {
    zoom: next.zoom,
    duration: 300,
  });
}
