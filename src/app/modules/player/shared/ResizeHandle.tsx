import { useEffect, useRef, useState } from "react";

const collapseOvershoot = 100;
const collapseHoldMs = 250;

export function ResizeHandle({ invert = false, label, max, min, onChange, onDraggingChange, snapCollapsed, onSnapChange, value }: {
  invert?: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (width: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
  snapCollapsed: boolean;
  onSnapChange: (collapsed: boolean) => void;
  value: number;
}) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ pointerId: number; width: number; x: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;
    let collapseTimer: number | undefined;
    const cancelCollapse = () => {
      window.clearTimeout(collapseTimer);
      collapseTimer = undefined;
    };
    const stop = () => {
      cancelCollapse();
      startRef.current = null;
      setDragging(false);
      onDraggingChange?.(false);
    };
    const move = (event: PointerEvent) => {
      const start = startRef.current;
      if (!start || event.pointerId !== start.pointerId) return;
      const delta = event.clientX - start.x;
      const width = start.width + (invert ? -delta : delta);
      onChange(Math.min(max, Math.max(min, width)));
      if (width > min - collapseOvershoot) {
        cancelCollapse();
      } else if (collapseTimer === undefined) {
        collapseTimer = window.setTimeout(() => {
          stop();
          onSnapChange(true);
        }, collapseHoldMs);
      }
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId === startRef.current?.pointerId) stop();
    };
    const cursor = document.body.style.cursor;
    const selection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", stop);
    return () => {
      cancelCollapse();
      startRef.current = null;
      document.body.style.cursor = cursor;
      document.body.style.userSelect = selection;
      onDraggingChange?.(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", stop);
    };
  }, [dragging, invert, max, min, onChange, onDraggingChange, onSnapChange]);

  if (snapCollapsed) {
    const restoreLabel = `Open ${label}`;
    return <button aria-label={restoreLabel} title={restoreLabel} className="resize-handle resize-handle-collapsed" type="button" onClick={() => onSnapChange(false)} />;
  }

  return (
    <div
      aria-label={`Resize ${label}`}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Math.round(value)}
      className="resize-handle"
      role="separator"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        onChange(Math.min(max, Math.max(min, value + (invert ? -direction : direction) * (event.shiftKey ? 24 : 8))));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || startRef.current) return;
        event.preventDefault();
        startRef.current = { pointerId: event.pointerId, width: value, x: event.clientX };
        onDraggingChange?.(true);
        setDragging(true);
      }}
    />
  );
}
