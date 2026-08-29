import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isViewerMode } from './viewer';
import { useUiStore } from './ui-store';
import {
  gesturePolicy,
  narrowChromeAt,
  sheetAt,
  wheelPanPreferred,
  type GesturePolicy,
} from './viewport-mode';

export type ViewportMode = {
  innerWidth: number;
  panelWidth: number;
  narrowChrome: boolean;
  /** Full-screen reading sheet (remaining width < one card). Not a React hook. */
  sheet: boolean;
  /** Sheet or narrow chrome: no MaterialReader, material stays on the desktop. */
  blockReader: boolean;
  coarse: boolean;
  hoverFine: boolean;
  wheelPan: boolean;
  gestures: GesturePolicy;
};

const DESKTOP: ViewportMode = {
  innerWidth: 1440,
  panelWidth: 520,
  narrowChrome: false,
  sheet: false,
  blockReader: false,
  coarse: false,
  hoverFine: true,
  wheelPan: true,
  gestures: gesturePolicy({ sheet: false, coarse: false, isViewer: false, wheelPan: true }),
};

let live: ViewportMode = DESKTOP;

export function getViewportMode(): ViewportMode {
  return live;
}

function readPointerFlags(): { coarse: boolean; hoverFine: boolean } {
  if (typeof window === 'undefined') return { coarse: false, hoverFine: true };
  return {
    coarse: window.matchMedia('(pointer: coarse)').matches,
    hoverFine: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
  };
}

function readMode(
  innerWidth: number,
  panelWidth: number,
  coarse: boolean,
  hoverFine: boolean,
): ViewportMode {
  const uaMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);
  const wheelPan = wheelPanPreferred({ hoverFine, pointerCoarse: coarse, uaMac });
  const narrowChrome = narrowChromeAt(innerWidth);
  const sheet = sheetAt(innerWidth, panelWidth);
  const gestures = gesturePolicy({ sheet, coarse, isViewer: isViewerMode, wheelPan });
  return {
    innerWidth, panelWidth, narrowChrome, sheet,
    blockReader: sheet || narrowChrome,
    coarse, hoverFine, wheelPan, gestures,
  };
}

function useViewportModeState(): ViewportMode {
  const panelWidth = useUiStore((s) => s.panelWidth);
  const [innerWidth, setInnerWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  const [pointer, setPointer] = useState(readPointerFlags);

  useEffect(() => {
    const onResize = () => setInnerWidth(window.innerWidth);
    const onPointer = () => {
      const next = readPointerFlags();
      setPointer((prev) =>
        prev.coarse === next.coarse && prev.hoverFine === next.hoverFine ? prev : next,
      );
    };
    window.addEventListener('resize', onResize);
    const widthMq = window.matchMedia('(max-width: 959px)');
    const coarseMq = window.matchMedia('(pointer: coarse)');
    const hoverMq = window.matchMedia('(hover: hover) and (pointer: fine)');
    widthMq.addEventListener('change', onResize);
    coarseMq.addEventListener('change', onPointer);
    hoverMq.addEventListener('change', onPointer);
    onResize();
    onPointer();
    return () => {
      window.removeEventListener('resize', onResize);
      widthMq.removeEventListener('change', onResize);
      coarseMq.removeEventListener('change', onPointer);
      hoverMq.removeEventListener('change', onPointer);
    };
  }, []);

  const mode = useMemo(
    () => readMode(innerWidth, panelWidth, pointer.coarse, pointer.hoverFine),
    [innerWidth, panelWidth, pointer.coarse, pointer.hoverFine],
  );

  useEffect(() => {
    live = mode;
  }, [mode]);

  return mode;
}

const ViewportModeContext = createContext<ViewportMode>(DESKTOP);

export function ViewportModeProvider({ children }: { children: ReactNode }) {
  const mode = useViewportModeState();
  return createElement(ViewportModeContext.Provider, { value: mode }, children);
}

export function useViewportMode(): ViewportMode {
  return useContext(ViewportModeContext);
}
