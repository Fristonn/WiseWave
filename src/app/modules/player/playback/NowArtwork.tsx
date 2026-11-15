import { useEffect, useRef, useState } from "react";
import type { Track } from "../../../mygo";
import { Artwork, hasArtworkURL, preferredArtworkURL } from "../../../shared/ui/Artwork";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { useCanvas } from "./useCanvas";

export function NowArtwork({
  track,
  playing,
  onOpen,
}: {
  track: Track;
  playing: boolean;
  onOpen: () => void;
}) {
  const canvas = useCanvas(track);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasCanvas = canvas.status === "ready" && !!canvas.url;
  const cover = hasArtworkURL(track.album_art_url) ? preferredArtworkURL(track.album_art_url, 720) : "";
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    setCoverFailed(false);
  }, [track.id, cover]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasCanvas) return;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    let visible = false;
    let active = true;
    const sync = () => {
      if (active && playing && visible && !document.hidden) {
        void video.play().then(() => {
          if (!active || !playing || !visible || document.hidden) video.pause();
        }).catch(() => {});
      } else video.pause();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(video);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      active = false;
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      video.pause();
    };
  }, [playing, hasCanvas, canvas.url, track.id]);

  return (
    <Tooltip label="Expand cover">
      <button
        className={`now-artwork ${hasCanvas ? "has-canvas" : "has-cover"}`}
        type="button"
        aria-label="Expand album artwork"
        onClick={onOpen}
      >
        <span className="now-artwork-media">
          {hasCanvas ? (
            <video
              key={`${track.id}-${canvas.url}`}
              ref={videoRef}
              className="now-canvas"
              src={canvas.url}
              poster={cover || undefined}
              muted
              loop
              playsInline
              preload="metadata"
            />
          ) : cover && !coverFailed ? (
            <Artwork
              className="now-cover"
              src={track.album_art_url}
              size={360}
              onFail={() => setCoverFailed(true)}
            />
          ) : (
            <Artwork className="now-cover-fallback" src={track.album_art_url} size={560} />
          )}
        </span>
        <span className="now-artwork-fade" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
