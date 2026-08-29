import { useEffect, useState } from 'react';

/** Distance the on-screen keyboard covers at the bottom of the layout
 *  viewport. 0 when `visualViewport` is missing. Never negative. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setInset(0);
    };
  }, []);
  return inset;
}
