// Cards mark text regions `nowheel` / `nopan` so a long answer can scroll
// without zooming the canvas. Those classes also kill Mac two-finger pan
// (a wheel event) when the box is idle — empty follow-up, short question,
// anything not actually overflowing. Consume the wheel only when the box
// can scroll in the gesture's direction; otherwise the canvas keeps it.

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

/** True when some ancestor of `start` (up to the canvas) can scroll this wheel. */
export function wheelConsumedByScroll(start: EventTarget | null, e: WheelEvent): boolean {
  if (!(start instanceof Element)) return false;
  let node: HTMLElement | null = start instanceof HTMLElement ? start : start.parentElement;
  const root = node?.closest('.react-flow') ?? null;
  while (node && node !== root) {
    if (overflowConsumesWheel(boxFromElement(node, e))) return true;
    node = node.parentElement;
  }
  return false;
}

/** Temporarily drop nowheel/nopan so React Flow's filter sees a free pane. */
export function liftWheelBlocks(start: EventTarget | null, root: ParentNode | null) {
  if (!(start instanceof Element) || !root) return;
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
