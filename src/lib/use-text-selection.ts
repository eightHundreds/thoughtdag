import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Selection inside `containerRef`. Desktop keeps a floating origin;
 *  callers on a sheet can ignore `pos` and render a fixed action bar.
 *  `originRef` (default: the container) is the box `pos` is measured against. */
export function useTextSelection(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  originRef?: RefObject<HTMLElement | null>,
) {
  const [text, setText] = useState('');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const frame = useRef(0);

  const read = useCallback(() => {
    if (!enabled) return;
    const el = containerRef.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0 || selection.toString().trim().length === 0) {
      setText('');
      setPos(null);
      return;
    }
    const anchor = selection.anchorNode;
    if (!anchor || !el.contains(anchor)) {
      setText('');
      setPos(null);
      return;
    }
    const next = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const rangeRect = range.getBoundingClientRect();
    const box = (originRef?.current ?? el).getBoundingClientRect();
    setText(next);
    setPos({
      x: rangeRect.left + rangeRect.width / 2 - box.left,
      y: rangeRect.top - box.top - 48,
    });
  }, [containerRef, enabled, originRef]);

  useEffect(() => {
    if (!enabled) {
      setText('');
      setPos(null);
      return;
    }
    const onChange = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(read);
    };
    document.addEventListener('selectionchange', onChange);
    document.addEventListener('pointerup', onChange);
    return () => {
      cancelAnimationFrame(frame.current);
      document.removeEventListener('selectionchange', onChange);
      document.removeEventListener('pointerup', onChange);
    };
  }, [enabled, read]);

  const clear = useCallback(() => {
    setText('');
    setPos(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  return { text, pos, clear };
}
