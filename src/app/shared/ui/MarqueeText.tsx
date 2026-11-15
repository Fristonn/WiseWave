import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";

const visibilityObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    (entry.target as HTMLElement).style.setProperty("--marquee-play-state", entry.isIntersecting ? "running" : "paused");
  }
}, { rootMargin: "100px" });

export interface MarqueeTextProps {
  children?: ReactNode;
  className?: string;
  title?: string;
  speed?: number;
}

export function MarqueeText({ children, className = "", title, speed }: MarqueeTextProps) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    visibilityObserver.observe(viewport);

    let active = true;
    let frame = 0;
    const measure = () => {
      if (!active) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = Math.max(0, Math.ceil(content.scrollWidth - viewport.clientWidth));
        setOverflow((prev) => (prev === next ? prev : next));
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    if (viewport.parentElement) observer.observe(viewport.parentElement);
    const mutations = new MutationObserver(measure);
    mutations.observe(content, { childList: true, characterData: true, subtree: true });
    measure();
    const fonts = document.fonts;
    fonts?.ready.then(measure).catch(() => {});

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      visibilityObserver.unobserve(viewport);
    };
  }, []);

  const duration = speed ? Math.max(6, 3 + overflow / speed) : Math.min(36, Math.max(18, 15 + overflow / 12));
  const autoTitle = title ?? (typeof children === "string" ? children : undefined);

  return (
    <Tooltip label={autoTitle || ""} enabled={overflow > 1 && Boolean(autoTitle)}>
      <span
        className={`player-marquee ${overflow > 1 ? "player-marquee-active" : ""} ${className}`}
        ref={viewportRef}
      >
        <span
          className="player-marquee-content"
          ref={contentRef}
          style={{
            "--player-marquee-distance": `${-overflow}px`,
            "--player-marquee-duration": `${duration}s`,
          } as CSSProperties}
        >
          {children}
        </span>
      </span>
    </Tooltip>
  );
}
