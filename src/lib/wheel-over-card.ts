// Cards mark text regions `nowheel` / `nopan` so a long answer can scroll
// without zooming the canvas. Those classes also kill Mac two-finger pan
// (a wheel event) when the box is idle — empty follow-up, short question,
// anything not actually overflowing. Consume the wheel only when the box
// can scroll in the gesture's direction; otherwise the canvas keeps it.
//
// Chrome/Safari turn leftover horizontal trackpad wheel into history
// swipe. Excalidraw never leaks that event (the canvas preventDefault's
// every wheel). Any unconsumed deltaX must be cancelled — even a small
// leftover on a mostly-vertical scroll, which is how the back gesture
// still fired after the first patch.

export interface OverflowBox {
  overflowY: string;
  overflowX: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  deltaX: number;
  deltaY: number;
}

const SCROLLABLE = new Set(['auto', 'scroll']);

export function overflowConsumesWheel(box: OverflowBox): boolean {
  if (SCROLLABLE.has(box.overflowY) && box.deltaY !== 0) {
    const max = box.scrollHeight - box.clientHeight;
    if (max > 1) {
      if (box.deltaY < 0 && box.scrollTop > 0) return true;
      if (box.deltaY > 0 && box.scrollTop < max - 1) return true;
    }
  }
  if (SCROLLABLE.has(box.overflowX) && box.deltaX !== 0) {
    const max = box.scrollWidth - box.clientWidth;
    if (max > 1) {
      if (box.deltaX < 0 && box.scrollLeft > 0) return true;
      if (box.deltaX > 0 && box.scrollLeft < max - 1) return true;
    }
  }
  return false;
}

/** True when this box cannot absorb deltaX — Chrome would treat it as Back. */
export function leftoverHorizontalSwipe(box: OverflowBox): boolean {
  if (box.deltaX === 0) return false;
  return !overflowConsumesWheel({ ...box, deltaY: 0 });
}

function boxFromElement(node: HTMLElement, e: WheelEvent): OverflowBox {
  const style = window.getComputedStyle(node);
  return {
    overflowY: style.overflowY,
    overflowX: style.overflowX,
    scrollTop: node.scrollTop,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    scrollLeft: node.scrollLeft,
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    deltaX: e.deltaX,
    deltaY: e.deltaY,
  };
}

function findOverflow(start: EventTarget | null, test: (node: HTMLElement) => boolean): HTMLElement | null {
  if (typeof Element === 'undefined' || !(start instanceof Element)) return null;
  let node: HTMLElement | null = start instanceof HTMLElement ? start : start.parentElement;
  const root = node?.closest('.react-flow') ?? document.documentElement;
  while (node && node !== root && node !== document.body) {
    if (test(node)) return node;
    node = node.parentElement;
  }
  return null;
}

function consumingBox(start: EventTarget | null, e: WheelEvent, axis: 'x' | 'y'): HTMLElement | null {
  return findOverflow(start, (node) => {
    const box = boxFromElement(node, e);
    return overflowConsumesWheel(axis === 'x' ? { ...box, deltaY: 0 } : { ...box, deltaX: 0 });
  });
}

/** True when some ancestor of `start` (up to the canvas) can scroll this wheel. */
export function wheelConsumedByScroll(start: EventTarget | null, e: WheelEvent): boolean {
  return findOverflow(start, (node) => overflowConsumesWheel(boxFromElement(node, e))) !== null;
}

/**
 * Cancel unless a real overflow box is scrolling this gesture.
 * ANY unconsumed deltaX is a browser-back swipe — not only X-dominant ones.
 */
export function shouldCancelBrowserSwipe(start: EventTarget | null, e: WheelEvent): boolean {
  if (e.ctrlKey || e.metaKey) return true;
  if (e.deltaX !== 0 && !consumingBox(start, e, 'x')) return true;
  return !wheelConsumedByScroll(start, e);
}

function wheelPixels(e: WheelEvent, axis: 'x' | 'y'): number {
  const v = axis === 'x' ? e.deltaX : e.deltaY;
  return e.deltaMode === 1 ? v * 16 : v;
}

/** Temporarily drop nowheel/nopan so React Flow's filter sees a free pane. */
export function liftWheelBlocks(start: EventTarget | null, root: ParentNode | null) {
  if (typeof Element === 'undefined' || !(start instanceof Element) || !root) return;
  const lifted: { el: HTMLElement; name: 'nowheel' | 'nopan' }[] = [];
  let node: HTMLElement | null = start instanceof HTMLElement ? start : start.parentElement;
  while (node && node !== root && node !== document.body) {
    if (node.classList.contains('nowheel')) {
      node.classList.remove('nowheel');
      lifted.push({ el: node, name: 'nowheel' });
    }
    if (node.classList.contains('nopan')) {
      node.classList.remove('nopan');
      lifted.push({ el: node, name: 'nopan' });
    }
    node = node.parentElement;
  }
  if (lifted.length === 0) return;
  requestAnimationFrame(() => {
    for (const { el, name } of lifted) el.classList.add(name);
  });
}

/** Boot-time guard: must not wait on React. Capture + non-passive. */
export function installWheelGuard(): void {
  const onWheel = (e: WheelEvent) => {
    const root = document.querySelector('.react-flow');
    if (e.ctrlKey || e.metaKey) {
      if (e.cancelable) e.preventDefault();
      liftWheelBlocks(e.target, root);
      return;
    }

    const xBox = consumingBox(e.target, e, 'x');
    const yBox = consumingBox(e.target, e, 'y');
    const leftoverX = e.deltaX !== 0 && !xBox;
    const xDominant = Math.abs(e.deltaX) > Math.abs(e.deltaY);

    // Unconsumed horizontal wheel IS Chrome/Safari history navigation.
    if (leftoverX && e.cancelable) e.preventDefault();

    if (xDominant || !yBox) {
      if (e.cancelable) e.preventDefault();
      liftWheelBlocks(e.target, root);
      return;
    }

    // Y-dominant over a Y scroller: native scroll died if we cancelled for
    // leftover X — apply it ourselves so the answer still scrolls.
    if (leftoverX && e.defaultPrevented) {
      yBox.scrollTop += wheelPixels(e, 'y');
    }
  };
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
}
