import { useEffect, useState } from "react";

export type VisualViewportState = {
  height: number;
  offsetTop: number;
  keyboardInset: number;
};

function read(): VisualViewportState {
  if (typeof window === "undefined") {
    return { height: 0, offsetTop: 0, keyboardInset: 0 };
  }
  const vv = window.visualViewport;
  if (!vv) {
    return { height: window.innerHeight, offsetTop: 0, keyboardInset: 0 };
  }
  const keyboardInset = Math.max(
    0,
    window.innerHeight - (vv.height + vv.offsetTop),
  );
  return { height: vv.height, offsetTop: vv.offsetTop, keyboardInset };
}

function isSame(a: VisualViewportState, b: VisualViewportState): boolean {
  return (
    a.height === b.height &&
    a.offsetTop === b.offsetTop &&
    a.keyboardInset === b.keyboardInset
  );
}

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => read());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    let frame = 0;
    let disposed = false;

    const schedule = () => {
      if (disposed || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (disposed) return;
        const next = read();
        setState((prev) => (isSame(prev, next) ? prev : next));
      });
    };

    schedule();
    if (vv) {
      vv.addEventListener("resize", schedule);
      vv.addEventListener("scroll", schedule);
    }
    window.addEventListener("resize", schedule);
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (vv) {
        vv.removeEventListener("resize", schedule);
        vv.removeEventListener("scroll", schedule);
      }
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return state;
}
