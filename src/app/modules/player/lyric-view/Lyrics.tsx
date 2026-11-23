import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Line, Track, Record } from "../../../mygo";
import type { LyricLine } from "../../../types/lyricRenderer";
import { artworkURL, loadedArtworkSource } from "../../../shared/ui/Artwork";
import LyricsRenderer from "./LyricsRenderer";
import { DEFAULT_LYRICS_THEME, useArtworkTheme } from "../shared/artworkColor";
import { createPlaybackClock, type PlaybackClock } from "./playbackClock";
import { normalizeLyricLines } from "./lyricLayout";

function isEmbeddedCredit(text: string): boolean {
  return /^\s*(?:lyrics?\s*(?:by)?|words\s*(?:by)?|written\s+by|songwriters?|lyricists?|composers?|composed\s+by|music\s+by|produced\s+by|publishers?|copyright)\s*[:：]\s*\S/i.test(text);
}

export function Lyrics({
  lines,
  credit,
  plain,
  loading,
  position,
  duration,
  playing,
  seekVersion,
  track,
  onSeek,
}: {
  lines: Line[];
  credit: Record | null;
  plain: string;
  loading: boolean;
  position: number;
  duration?: number;
  playing?: boolean;
  seekVersion: number;
  track?: Track | null;
  onSeek: (seconds: number) => void;
}) {
  const [settings, setSettings] = useState<{ lyrStyle?: string; lyr?: boolean; lyrSize?: string; lyrOffset?: string; art?: boolean }>(() => {
    try { return JSON.parse(localStorage.getItem("wisewave-settings") || "{}"); }
    catch { return {}; }
  });
  const offset = Number.parseInt(settings.lyrOffset || "0", 10) || 0;
  const fontSize = settings.lyrSize === "Small" ? 32 : settings.lyrSize === "Large" ? 48 : 40;
  const [clock] = useState<PlaybackClock>(createPlaybackClock);
  const durationSeconds = duration && duration > 0 ? duration : track?.duration_seconds || 0;

  useEffect(() => {
    const update = (event: Event) => setSettings((event as CustomEvent<typeof settings>).detail);
    window.addEventListener("wisewave-settings-changed", update);
    return () => window.removeEventListener("wisewave-settings-changed", update);
  }, []);

  useLayoutEffect(() => {
    clock.update(
      position,
      durationSeconds,
      Boolean(playing),
      track?.id,
      undefined,
      seekVersion,
      offset
    );
  }, [clock, position, durationSeconds, playing, track?.id, seekVersion, offset]);

  const plainText = useMemo(() => {
    const value = plain.trim();
    if (!value) return "";
    const normalized = value.toLowerCase().replace(/[.!]+$/g, "");
    if (normalized === "lyrics unavailable" || normalized === "no lyrics found" || normalized === "lyrics not found") return "";
    return value.split(/\r?\n/).filter((line) => !isEmbeddedCredit(line)).join("\n").trim();
  }, [plain]);
  const lyricLines = useMemo(() => lines.filter((line) => !isEmbeddedCredit(line.text || "")), [lines]);
  const timed = useMemo(() => {
    if (settings.lyr === false) return [];
    const tolerance = Math.max(3, durationSeconds * 0.02);
    if (durationSeconds > 0 && credit?.duration && Math.abs(credit.duration - durationSeconds) > tolerance) return [];
    const result = normalizeLyricLines(lyricLines, durationSeconds > 0 ? durationSeconds * 1000 : Infinity);
    return result.some((line) => line.text.trim() && ((line.startTimeMs ?? 0) > 0 || line.syllables?.some((unit) => unit.startTimeMs > 0))) ? result : [];
  }, [lyricLines, settings.lyr, durationSeconds, credit?.duration]);
  const normalized = useMemo<LyricLine[]>(() => {
    if (timed.length) return timed;
    const text = plainText ? plainText.split(/\r?\n/) : lyricLines.filter((line) => !line.is_background).map((line) => line.text);
    return text.filter((line) => line?.trim()).map((text) => ({ text, startTimeMs: null }));
  }, [timed, lyricLines, plainText]);
  const type = !timed.length ? "PLAIN" : timed.some((line) => line.syllables?.length) ? "SYLLABLE_SYNCED" : "LINE_SYNCED";

  const handleSelect = useCallback(
    (positionMs: number) => {
      onSeek(Math.max(0, (positionMs + offset) / 1000));
    },
    [onSeek, offset]
  );

  const unavailable = !loading && !lyricLines.length && !plainText;
  const dynamicBackground = settings.art === true;
  const artworkTheme = useArtworkTheme(track);
  const theme = dynamicBackground ? artworkTheme : DEFAULT_LYRICS_THEME;
  const artworkSrc = track?.album_art_url || "";
  const resolvedBackdrop = dynamicBackground && artworkSrc ? loadedArtworkSource(artworkSrc) || artworkURL(artworkSrc, 160) || artworkSrc : "";
  const [backdropUrl, setBackdropUrl] = useState(resolvedBackdrop);
  const [backdropFailed, setBackdropFailed] = useState(false);

  useEffect(() => {
    setBackdropUrl(resolvedBackdrop);
    setBackdropFailed(false);
  }, [resolvedBackdrop, track?.id]);

  const showBlur = Boolean(backdropUrl) && !backdropFailed;

  const rendererTrack = {
    trackId: track?.id || "",
    duration: durationSeconds * 1000,
    artworkUrl: track?.album_art_url || null,
  };

  return (
    <div
      className={`player-lyrics-wrapper${showBlur ? " has-blur-bg" : ""}`}
      style={
        {
          "--lyrics-font-size": `${fontSize}px`,
          "--lyrics-font-scale": fontSize / 40,
          "--lyrics-bg": theme.background,
          "--lyrics-active-text": theme.activeText,
          "--lyrics-inactive-text": theme.inactiveText,
          "--lyrics-flipbook-fill": theme.flipbookFill,
        } as CSSProperties
      }
    >
      {backdropUrl ? (
        <img
          className="player-lyrics-backdrop"
          src={backdropUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            if (backdropUrl !== artworkSrc && artworkSrc) {
              setBackdropUrl(artworkSrc);
              return;
            }
            setBackdropFailed(true);
          }}
        />
      ) : null}
      <LyricsRenderer
        credit={credit}
        activeIndex={-1}
        clock={clock}
        isLoading={loading}
        lines={normalized}
        lyricsRef={useRef<HTMLDivElement>(null)}
        onSelect={handleSelect}
        style={settings.lyrStyle === "Focus" ? "Focus" : "Default"}
        syncVersion={seekVersion}
        track={rendererTrack}
        translationLines={null}
        type={type}
        unavailable={unavailable}
      />
    </div>
  );
}
