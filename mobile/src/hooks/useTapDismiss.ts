import { useEffect } from "react";

// Every tap-toggled tooltip/selection in the Time charts only closed if you tapped
// the exact same cell again -- easy to miss on a small touch target, and otherwise
// stuck open indefinitely. This is the "tap anywhere else to dismiss" fallback,
// mirroring how a native picker/tooltip behaves.
export function useTapDismiss(ref: React.RefObject<HTMLElement | null>, onDismiss: () => void) {
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [ref, onDismiss]);
}
