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

function readMode(innerWidth: number, panelWidth: number): ViewportMode {
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const hoverFine = typeof window !== 'undefined'
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
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

  useEffect(() => {
    const onResize = () => setInnerWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    const mqls = [
      window.matchMedia('(max-width: 959px)'),
      window.matchMedia('(pointer: coarse)'),
      window.matchMedia('(hover: hover) and (pointer: fine)'),
    ];
    for (const m of mqls) m.addEventListener('change', onResize);
    onResize();
    return () => {
      window.removeEventListener('resize', onResize);
      for (const m of mqls) m.removeEventListener('change', onResize);
    };
  }, []);

  const mode = useMemo(() => readMode(innerWidth, panelWidth), [innerWidth, panelWidth]);

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
