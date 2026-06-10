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

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => read());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    const handler = () => setState(read());
    handler();
    if (vv) {
      vv.addEventListener("resize", handler);
      vv.addEventListener("scroll", handler);
    }
    window.addEventListener("resize", handler);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", handler);
        vv.removeEventListener("scroll", handler);
      }
      window.removeEventListener("resize", handler);
    };
  }, []);

  return state;
}
