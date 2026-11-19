import { currentWindow, isMyGo, runtime } from "mygo-runtime";
import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { CaptionControls, events } from "../../../mygo";

type CaptionBounds = [right: number, top: number, width: number, height: number];
const hiddenBounds: CaptionBounds = [0, 0, 0, 0];
let pendingBounds: CaptionBounds | undefined;
let sendingBounds = false;

function tooltipEvents(button: "minimize" | "maximize" | "close") {
  const update = (visible: boolean) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") {
      void CaptionControls.setTooltip(button, visible).catch(() => {});
    }
  };
  return { onPointerEnter: update(true), onPointerLeave: update(false), onPointerDown: update(false) };
}

async function sendBounds(bounds: CaptionBounds) {
  pendingBounds = bounds;
  if (sendingBounds) return;
  sendingBounds = true;
  while (pendingBounds) {
    const next = pendingBounds;
    pendingBounds = undefined;
    await CaptionControls.setMaximizeBounds(...next).catch(() => {});
  }
  sendingBounds = false;
}

export function WindowCaption({ blocked }: { blocked: boolean }) {
  if (!isMyGo() || runtime().platform !== "win32") return null;
  return <CaptionButtons blocked={blocked} />;
}

function CaptionButtons({ blocked }: { blocked: boolean }) {
  const maximizeButton = useRef<HTMLButtonElement>(null);
  const [maximized, setMaximized] = useState(false);
  const [pointer, setPointer] = useState("idle");
  const [focused, setFocused] = useState(() => document.hasFocus());

  useLayoutEffect(() => {
    let active = true;
    let maximizeEventReceived = false;
    const offPointer = events.captionPointerChanged.on(setPointer);
    const offMaximized = events.captionMaximizedChanged.on((value) => {
      maximizeEventReceived = true;
      setMaximized(value);
    });
    void currentWindow.isMaximized().then((value) => {
      if (active && !maximizeEventReceived) setMaximized(value);
    }).catch(() => {});
    const syncFocus = () => setFocused(document.hasFocus());
    window.addEventListener("focus", syncFocus);
    window.addEventListener("blur", syncFocus);
    return () => {
      active = false;
      offPointer();
      offMaximized();
      window.removeEventListener("focus", syncFocus);
      window.removeEventListener("blur", syncFocus);
    };
  }, []);

  useLayoutEffect(() => {
    const button = maximizeButton.current;
    if (!button) return;
    if (blocked) {
      void sendBounds(hiddenBounds);
      void CaptionControls.setTooltip("", false).catch(() => {});
      return;
    }

    let frame = 0;
    let previous: CaptionBounds | undefined;
    let resolution: MediaQueryList;

    const syncBounds = () => {
      frame = 0;
      const rect = button.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const bounds: CaptionBounds =
        !document.hidden && target && button.contains(target)
          ? [Math.max(0, window.innerWidth - rect.right), Math.max(0, rect.top), rect.width, rect.height]
          : hiddenBounds;
      if (previous?.every((value, index) => value === bounds[index])) return;
      previous = bounds;
      void sendBounds(bounds);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(syncBounds);
    };
    const watchResolution = () => {
      resolution?.removeEventListener("change", watchResolution);
      resolution = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener("change", watchResolution);
      schedule();
    };

    const size = new ResizeObserver(schedule);
    size.observe(button);
    const header = button.closest(".topbar");
    if (header) size.observe(header);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true });
    const content = button.closest(".app-content");
    if (content) mutations.observe(content, { attributes: true, attributeFilter: ["inert"] });
    window.addEventListener("resize", schedule);
    window.addEventListener("wisewave-zoom-changed", schedule);
    const syncVisibility = () => {
      if (document.hidden) {
        previous = hiddenBounds;
        void sendBounds(hiddenBounds);
      } else {
        schedule();
      }
    };
    document.addEventListener("visibilitychange", syncVisibility);
    watchResolution();

    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      mutations.disconnect();
      resolution?.removeEventListener("change", watchResolution);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("wisewave-zoom-changed", schedule);
      document.removeEventListener("visibilitychange", syncVisibility);
      void sendBounds(hiddenBounds);
      void CaptionControls.setTooltip("", false).catch(() => {});
    };
  }, [blocked]);

  return <div className="window-caption" data-inactive={!focused}>
    <button type="button" aria-label="Minimize" {...tooltipEvents("minimize")} onClick={() => void currentWindow.minimize().catch(() => {})}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6.5h10" /></svg>
    </button>
    <button type="button" aria-label={maximized ? "Restore down" : "Maximize"} ref={maximizeButton} data-pointer={pointer}
      {...tooltipEvents("maximize")}
      onClick={() => void currentWindow.toggleMaximize().then(() => currentWindow.isMaximized()).then(setMaximized).catch(() => {})}>
      <svg viewBox="0 0 12 12" aria-hidden="true">{maximized
        ? <path d="M3.5 3.5v-2h7v7h-2m-7-5h7v7h-7z" />
        : <path d="M1.5 1.5h9v9h-9z" />}</svg>
    </button>
    <button type="button" aria-label="Close" className="window-caption-close" {...tooltipEvents("close")} onClick={() => void currentWindow.close().catch(() => {})}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1.5 1.5 9 9m0-9-9 9" /></svg>
    </button>
  </div>;
}
