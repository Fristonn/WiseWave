import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { isMyGo } from "mygo-runtime";
import { Discord, Playback, TrayControl, events, type DiscordProfile, type SpotifyImportResult, type YouTubeImportResult, type Track } from "../../mygo";
import { preferredArtworkURL } from "../../shared/ui/Artwork";
import { Classic } from "../../shared/ui/Classic";
import { MarqueeText } from "../../shared/ui/MarqueeText";
import { PlayerAlert } from "../player/shared/PlayerAlert";
import { clearSearchHistory } from "../player/search/SearchBox";
import { useSnackbar } from "../../shared/ui/Snackbar";
import { AudioLines, BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, ExternalLink, LockKeyhole, Mic2, Palette, RefreshCw, Search, X } from "lucide-react";
import { appVersion } from "../../version";
import appIcon from "../../../../resources/images/icon.png";
import lyricsLicense from "../../../../resources/licenses/accompanist-lyrics-license.txt?raw";
import lyricsNotice from "../../../../resources/licenses/accompanist-lyrics-notice.txt?raw";
import loadingLicense from "../../../../resources/licenses/loading-ui-license.txt?raw";
import reactLicense from "../../../../node_modules/react/LICENSE?raw";
import reactDomLicense from "../../../../node_modules/react-dom/LICENSE?raw";
import lucideLicense from "../../../../node_modules/lucide-react/LICENSE?raw";
import lottieLicense from "../../../../node_modules/lottie-web/LICENSE.md?raw";
import mygoLicense from "../../../../node_modules/mygo-runtime/LICENSE?raw";
import goAACLicense from "../../../../resources/licenses/go-aac-license.txt?raw";
import goAudioStreamLicense from "../../../../resources/licenses/go-audio-stream-license.txt?raw";
import goM4ALicense from "../../../../resources/licenses/go-m4a-license.txt?raw";
import simdLicense from "../../../../resources/licenses/simd-license.txt?raw";
import { LYRIC_SOURCES } from "../player/lyric-view/LyricCredit";
import { ProgressStylePreview } from "../player/playback/ProgressStylePreview";
import { PROGRESS_STYLES, readProgressStyle, type ProgressStyle } from "../player/playback/progressStyle";
import { readZoom, setZoom, ZOOM_LEVELS } from "../../shared/zoom";
import { Equalizer } from "./Equalizer";
import { SettingsDropdown } from "./SettingsDropdown";
import { DeleteConfirmation } from "../player/library/PlaylistMenu";
import { YouTubeConnection, YouTubeIcon } from "../accounts/YouTube/YouTubeConnection";
import { SpotifyConnection, SpotifyIcon } from "../accounts/Spotify/SpotifyConnection";

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function discordBadges(flags: number) {
  return [
    [1, "Discord Staff"], [2, "Partnered Server Owner"], [4, "HypeSquad Events"], [8, "Bug Hunter"], [64, "House Bravery"], [128, "House Brilliance"], [256, "House Balance"], [512, "Early Supporter"], [16384, "Bug Hunter Level 2"], [65536, "Verified Bot"], [131072, "Early Verified Bot Developer"], [262144, "Certified Moderator"], [4194304, "Active Developer"],
  ].filter(([flag]) => (flags & Number(flag)) !== 0).map(([, label]) => String(label));
}

function ZoomControl() {
  const [zoom, setCurrent] = useState(readZoom);
  useEffect(() => {
    const sync = () => setCurrent(readZoom());
    window.addEventListener("wisewave-zoom-changed", sync);
    return () => window.removeEventListener("wisewave-zoom-changed", sync);
  }, []);
  return <div className="settings-zoom">
    <div className="settings-zoom-previews" role="group" aria-label="Scale presets">
      {[{ label: "Dense", scale: 0.7 }, { label: "Default", scale: 1 }, { label: "Spacious", scale: 1.3 }].map(({ label, scale }, index) => <button type="button" key={label} className={`settings-zoom-preview ${zoom === scale ? "is-active" : ""}`} aria-pressed={zoom === scale} onClick={() => setZoom(scale)}>
        <span className={`settings-zoom-diagram diagram-${index}`}><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
        <span>{label}</span>
      </button>)}
    </div>
    <div className="settings-zoom-levels" role="radiogroup" aria-label="Zoom level">
      {ZOOM_LEVELS.map((level) => <label className="settings-zoom-option" key={level}>
        <input type="radio" name="zoom-level" value={level} checked={zoom === level} onChange={() => setZoom(level)} />
        <span>{Math.round(level * 100)}%</span>
      </label>)}
    </div>
  </div>;
}

export interface SettingsProps {
  onClose: () => void;
  onClearHistory: () => boolean;
  discordEnabled: boolean;
  onDiscordEnabled: (value: boolean) => void;
  privateListening?: boolean;
  autoplay: boolean;
  onAutoplay: (value: boolean) => void;
  repeat: boolean;
  onRepeat: (value: boolean) => void;
  track?: Track | null;
  position?: number;
  duration?: number;
  onImportSpotify?: (result: SpotifyImportResult) => number;
  onImportYouTube?: (result: YouTubeImportResult) => number;
}

const DEFAULT_SETTINGS = {
  ui: "Default",
  progressStyle: "Default",
  art: false,
  motion: false,
  tray: true,
  mini: false,
  startup: "No",
  norm: false,
  vol: 100,
  auto: true,
  resume: true,
  watch: true,
  minlen: 30,
  lyr: true,
  lyrStyle: "Default",
  lyrSize: "Medium",
  lyrOffset: "0 ms",
  dc: true,
  jr: true,
  jrprompt: "After each session",
  jrmood: true,
  jrtime: "21:00",
  jrlock: false,
  jrfmt: "Markdown",
  notif: true,
  nTrack: false,
  nNew: true,
  nUpd: true,
  quiet: false,
  qs: "22:00",
  qe: "07:00",
  gkeys: true,
  hist: true,
};

type SettingsState = typeof DEFAULT_SETTINGS;

const clearConfirmations = {
  hist: { title: "Clear recently played songs?", description: "This will remove the songs from your recently played list." },
  searchHistory: { title: "Clear recent searches?", description: "This will remove the searches saved in WiseWave." },
  cache: { title: "Clear cached songs?", description: "This will remove temporarily cached songs. Your downloads won't be affected." },
};

interface SettingRowDef {
  k?: keyof SettingsState;
  l: string;
  d?: string | null;
  dep?: keyof SettingsState;
  t: "tog" | "seg" | "dd" | "prog" | "zoom" | "eq" | "rng" | "time" | "btn" | "txt" | "kb";
  o?: readonly string[];
  min?: number;
  max?: number;
  u?: string;
  z?: string;
  s?: number;
  a?: string;
  b?: string;
  v?: string | string[];
}

interface SettingGroupDef {
  h: string;
  r: SettingRowDef[];
}

interface SettingSectionDef {
  t: string;
  pre?: "discord" | "spotify" | "youtube";
  g: SettingGroupDef[];
}

const SETTINGS_SECTIONS: Record<string, SettingSectionDef> = {
  appearance: {
    t: "Appearance",
    g: [
      {
        h: "Display",
        r: [
          { l: "Zoom level", d: "Adjust the size of the interface.", t: "zoom" },
          { k: "motion", l: "Reduce motion", d: "Turn off animations and transitions.", t: "tog" },
        ],
      },
      {
        h: "Window",
        r: [
          { k: "tray", l: "Minimize to tray", d: "Keep music playing when you close the window.", t: "tog" },
          { k: "mini", l: "Show mini player when minimized", t: "tog" },
          { k: "startup", l: "Open WiseWave automatically after you log in", o: ["Minimized", "Yes", "No"], t: "dd" },
        ],
      },
    ],
  },
  playback: {
    t: "Playback",
    g: [
      {
        h: "Sound",
        r: [
          { k: "norm", l: "Normalize volume", d: "Keeps loudness even between tracks.", t: "tog" },
          { k: "vol", l: "Startup volume", min: 0, max: 100, u: "%", z: "Muted", t: "rng" },
          { l: "Equalizer", d: "Adjust the sound across six frequency bands.", t: "eq" },
        ],
      },
      {
        h: "Player",
        r: [
          { k: "resume", l: "Resume playback", d: "Pick up where you left off after restarting WiseWave.", t: "tog" },
          {
            k: "progressStyle",
            l: "Progress style",
            o: PROGRESS_STYLES,
            d: "Choose the look of the player timeline.",
            t: "prog",
          },
        ],
      },
      {
        h: "Queue",
        r: [
          { k: "auto", l: "Autoplay similar music", d: "Keep playing when your queue ends.", t: "tog" },
        ],
      },
    ],
  },
  lyrics: {
    t: "Lyrics",
    g: [
      {
        h: "Display",
        r: [
          { k: "lyr", l: "Synced lyrics", d: "Follow each line with the music.", t: "tog" },
          {
            k: "art",
            l: "Dynamic lyrics background",
            d: "Soft album art behind the lyrics. Turn off for a plain solid color.",
            t: "tog",
          },
          {
            k: "lyrStyle",
            l: "Lyrics style",
            o: ["Default", "Focus"],
            d: "Choose how synced lyrics animate.",
            t: "dd",
          },
          {
            k: "lyrSize",
            l: "Text size",
            o: ["Small", "Medium", "Large"],
            d: "Choose a comfortable lyrics size.",
            t: "dd",
          },
        ],
      },
      {
        h: "Timing",
        r: [
          {
            k: "lyrOffset",
            l: "Timing offset",
            o: ["-1000 ms", "-500 ms", "0 ms", "+500 ms", "+1000 ms"],
            d: "Adjust lyrics that appear early or late.",
            t: "dd",
          },
        ],
      },
    ],
  },
  discord: {
    t: "Discord",
    pre: "discord",
    g: [
      {
        h: "Presence",
        r: [
          { k: "dc", l: "Show on Discord", d: "Display your current music activity in your Discord status.", t: "tog" },
        ],
      },
    ],
  },
  youtube: { t: "YouTube Music", pre: "youtube", g: [] },
  spotify: {
    t: "Spotify",
    pre: "spotify",
    g: [],
  },
  privacy: {
    t: "Data Controls",
    g: [
      {
        h: "History",
        r: [
          { l: "Clear recently played songs", d: "Remove your recently played songs.", a: "hist", b: "Clear", t: "btn" },
          { l: "Clear recent searches", d: "Remove the searches saved in WiseWave.", a: "searchHistory", b: "Clear", t: "btn" },
        ],
      },
      {
        h: "Playback cache",
        r: [
          { l: "Songs saved for quick playback", d: "Songs kept temporarily for faster playback.", a: "cache", b: "Clear cache", t: "btn" },
        ],
      },
    ],
  },
  about: { t: "About", g: [] },
};

const LICENSES = [
  { name: "React", license: "MIT", text: reactLicense },
  { name: "React DOM", license: "MIT", text: reactDomLicense },
  { name: "Lucide React", license: "ISC", text: lucideLicense },
  { name: "Lottie Web", license: "MIT", text: lottieLicense },
  { name: "MyGo Runtime", license: "MIT", text: mygoLicense },
  { name: "Accompanist Lyrics UI", license: "Apache 2.0", text: `${lyricsNotice}\n\n${lyricsLicense}` },
  { name: "loading ui", license: "MIT", text: loadingLicense },
  { name: "go-aac", license: "LGPL-2.1-or-later", text: goAACLicense },
  { name: "go-audio-stream", license: "MIT", text: goAudioStreamLicense },
  { name: "go-m4a", license: "MIT", text: goM4ALicense },
  { name: "simd", license: "MIT", text: simdLicense },
];

const NAV_GROUPS = [
  ["Music", ["appearance", "playback", "lyrics"]],
  ["Connect", ["youtube", "spotify", "discord"]],
  ["System", ["privacy", "about"]],
] as const;

function DiscordIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}


const NAV_ICONS = { appearance: Palette, playback: AudioLines, lyrics: Mic2, spotify: SpotifyIcon, youtube: YouTubeIcon, discord: DiscordIcon, privacy: LockKeyhole, about: CircleHelp };

export function Settings({
  onClose,
  onClearHistory,
  discordEnabled,
  onDiscordEnabled,
  privateListening = false,
  autoplay,
  onAutoplay,
  repeat,
  onRepeat,
  track,
  position = 0,
  duration = 0,
  onImportSpotify,
  onImportYouTube,
}: SettingsProps) {
  const currentPosition = position;
  const currentDuration = duration;
  const [st, setSt] = useState<SettingsState>(() => {
    try {
      const stored = localStorage.getItem("wisewave-settings");
      const parsed = stored ? JSON.parse(stored) : {};
      ["dcPreset", "dcLine1", "dcLine2", "dcLine3", "dcArt", "dcTime", "dcPause"].forEach((key) => delete parsed[key]);
      if (parsed.lyrStyle === "Glow" || parsed.lyrStyle === "Eeriee") parsed.lyrStyle = "Default";
      parsed.progressStyle = readProgressStyle(parsed.progressStyle);
      delete parsed.startup;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        vol: typeof parsed.vol === "number" && Number.isFinite(parsed.vol) ? Math.round(Math.max(0, Math.min(100, parsed.vol))) : DEFAULT_SETTINGS.vol,
        auto: typeof autoplay === "boolean" ? autoplay : parsed.auto ?? DEFAULT_SETTINGS.auto,
        dc: typeof discordEnabled === "boolean" ? discordEnabled : parsed.dc ?? DEFAULT_SETTINGS.dc,
      };
    } catch {
      return {
        ...DEFAULT_SETTINGS,
        auto: autoplay,
        dc: discordEnabled,
      };
    }
  });

  const [activeSection, setActiveSection] = useState<string>("appearance");
  const [discordProfile, setDiscordProfile] = useState<DiscordProfile | null>(null);
  const [showLicenses, setShowLicenses] = useState(false);
  const [clearTarget, setClearTarget] = useState<keyof typeof clearConfirmations | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheRevision, setCacheRevision] = useState(0);
  const [cacheCount, setCacheCount] = useState<number | "error" | null>(null);
  const [showLyricsSources, setShowLyricsSources] = useState(false);
  const [query, setQuery] = useState("");
  const showCacheCount = activeSection === "privacy" || Boolean(query.trim());
  useEffect(() => {
    if (!showCacheCount || !isMyGo()) return;
    let active = true;
    void Playback.cachedSongCount().then((count) => {
      if (active) setCacheCount(count);
    }).catch(() => { if (active) setCacheCount("error"); });
    return () => { active = false; };
  }, [showCacheCount, cacheRevision]);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [startupMode, setStartupMode] = useState<string | null>(null);
  const [savingStartup, setSavingStartup] = useState(false);
  const [progressPickerOpen, setProgressPickerOpen] = useState(false);
  const [progressPickerClosing, setProgressPickerClosing] = useState(false);
  const progressPickerTimer = useRef<number | null>(null);
  const [note, setNote] = useState<string>("");
  const dismissNote = useCallback(() => setNote(""), []);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const mainRef = useRef<HTMLElement | null>(null);
  const showSnackbar = useSnackbar();
  const [openingUpdater, setOpeningUpdater] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");
  const updateRequest = useRef<Promise<string> | null>(null);
  const canCheckForUpdates = isMyGo();
  const refreshUpdateStatus = useCallback(() => {
    if (updateRequest.current) return updateRequest.current;
    const request = TrayControl.updateStatus()
      .catch(() => "error")
      .then((status) => { setUpdateStatus(status); return status; })
      .finally(() => { updateRequest.current = null; });
    updateRequest.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (canCheckForUpdates && activeSection === "about" && !showLicenses && !query.trim()) {
      void refreshUpdateStatus();
    }
  }, [activeSection, canCheckForUpdates, query, refreshUpdateStatus, showLicenses]);

  const updateStatusText = !canCheckForUpdates || updateStatus === "unavailable"
    ? "update checks are unavailable in this build"
    : updateStatus === "current" ? "You’re up to date"
    : updateStatus === "available" ? "Update available"
    : updateStatus === "error" ? "couldn't check for updates"
    : "Checking for updates…";

  const checkForUpdates = async () => {
    setOpeningUpdater(true);
    try {
      if (await refreshUpdateStatus() === "available") await TrayControl.checkForUpdates();
    } catch {
      showSnackbar({ text: "couldn't open the update window" });
    } finally {
      setOpeningUpdater(false);
    }
  };

  const clearCache = async () => {
    setClearingCache(true);
    showSnackbar({ key: "clear-audio-cache", text: "clearing saved songs", loading: true, duration: -2 });
    try {
      const result = await Playback.clearCachedSongs();
      showSnackbar({ key: "clear-audio-cache", text: result.failed ? "couldn't clear some saved songs" : "saved songs cleared" });
    } catch {
      showSnackbar({ key: "clear-audio-cache", text: "couldn't clear saved songs" });
    } finally {
      setCacheRevision((value) => value + 1);
      setClearingCache(false);
    }
  };

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof autoplay === "boolean" && autoplay !== st.auto) {
      setSt((prev) => ({ ...prev, auto: autoplay }));
    }
  }, [autoplay]);

  useEffect(() => {
    if (typeof discordEnabled === "boolean" && discordEnabled !== st.dc) {
      setSt((prev) => ({ ...prev, dc: discordEnabled }));
    }
  }, [discordEnabled]);

  useEffect(() => {
    if (activeSection !== "discord" || !st.dc) {
      setDiscordProfile(null);
      return;
    }
    let alive = true;
    const refresh = () => {
      void Discord.profile().then((profile) => {
        if (alive) setDiscordProfile(profile.id && profile.username ? profile : null);
      }).catch(() => { if (alive) setDiscordProfile(null); });
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [activeSection, st.dc]);

  const saveSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSt((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem("wisewave-settings", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("wisewave-settings-changed", { detail: next }));
      } catch {}

      const root = document.documentElement;
      if (key === "ui") root.dataset.ui = String(value).toLowerCase();
      if (key === "motion") root.dataset.motion = value ? "reduce" : "";

      if (key === "auto" && typeof value === "boolean") onAutoplay(value);
      if (key === "dc" && typeof value === "boolean") onDiscordEnabled(value);

      try {
        window.dispatchEvent(new Event("wisewave-settings-updated"));
      } catch {}

      return next;
    });
  };

  const updateSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    if (key === "hist" && value === false) {
      if (!onClearHistory()) {
        setNote("couldn't clear your recently played songs");
        return;
      }
      saveSetting(key, value);
      setNote("recently played songs cleared");
      return;
    }
    if (key === "startup") {
      if (savingStartup || startupMode === null || startupMode === "Unavailable" || startupMode === value) return;
      setSavingStartup(true);
      void TrayControl.setStartupMode(String(value)).then(() => {
        setStartupMode(String(value));
      }).catch(async () => {
        setNote("couldn't save your startup setting");
        const mode = await TrayControl.startupMode().catch(() => null);
        if (mode !== null) setStartupMode(mode);
      }).finally(() => setSavingStartup(false));
      return;
    }
    saveSetting(key, value);
  };

  useEffect(() => {
    if (!isMyGo()) {
      setStartupMode("Unavailable");
      return;
    }
    void TrayControl.startupMode().then(setStartupMode).catch(() => {
      setStartupMode("Unavailable");
      setNote("couldn't check your startup setting");
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.ui = (st.ui || "Default").toLowerCase();
    root.dataset.motion = st.motion ? "reduce" : "";
  }, []);

  const confirmClear = () => {
    setClearTarget(null);
    if (clearTarget === "cache") void clearCache();
    else if (clearTarget === "hist") setNote(onClearHistory() ? "recently played songs cleared" : "couldn't clear your recently played songs");
    else if (clearTarget === "searchHistory") setNote(clearSearchHistory() ? "recent searches cleared" : "couldn't clear your recent searches");
  };

  const closeSettings = () => {
    if (closeTimer.current !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce") {
      onCloseRef.current();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), 150);
  };

  const closeProgressPicker = () => {
    if (progressPickerTimer.current !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce") {
      setProgressPickerOpen(false);
      return;
    }
    setProgressPickerClosing(true);
    progressPickerTimer.current = window.setTimeout(() => {
      setProgressPickerOpen(false);
      setProgressPickerClosing(false);
      progressPickerTimer.current = null;
    }, 150);
  };

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    if (progressPickerTimer.current !== null) window.clearTimeout(progressPickerTimer.current);
  }, []);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest(".settings-dd")) {
        setOpenDropdown(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (progressPickerOpen) closeProgressPicker();
        else if (openDropdown) setOpenDropdown(null);
        else closeSettings();
      }
    };
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openDropdown, progressPickerOpen]);

  const isDimmed = (dep?: keyof SettingsState) => {
    if (!dep) return false;
    return !st[dep];
  };

  const formatRangeValue = (r: SettingRowDef, val: number) => {
    if (val === 0 && r.z) return r.z;
    return `${val}${r.u === "%" ? "" : " "}${r.u || ""}`;
  };

  const renderControl = (r: SettingRowDef) => {
    if (!r.k && r.t !== "btn" && r.t !== "txt") return null;
    const val = r.k === "startup" ? startupMode : r.k ? st[r.k] : undefined;

    switch (r.t) {
      case "tog":
        return (
          <button
            type="button"
            className="settings-tog"
            role="switch"
            aria-checked={Boolean(val)}
            aria-label={r.l}
            onClick={() => r.k && updateSetting(r.k, !val as any)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                if (r.k) updateSetting(r.k, !val as any);
              }
            }}
          />
        );

      case "seg":
        return (
          <div className="settings-seg" role="group" aria-label={r.l}>
            {r.o?.map((opt) => (
              <button
                type="button"
                key={opt}
                aria-pressed={opt === val}
                onClick={() => r.k && updateSetting(r.k, opt as any)}
              >
                {opt}
              </button>
            ))}
          </div>
        );

      case "prog": {
        return (
          <button
            type="button"
            className="surface-btn"
            aria-haspopup="dialog"
            aria-expanded={progressPickerOpen}
            onClick={() => setProgressPickerOpen(true)}
          >
            Customize
          </button>
        );
      }

      case "dd": {
        const key = r.k;
        if (!key) return null;
        const startup = key === "startup";
        const lyricsStyle = key === "lyrStyle";
        const busy = startup && (startupMode === null || savingStartup);
        const options = (r.o || []).map((option) => lyricsStyle ? {
          value: option,
          label: option === "Focus" ? "Line Focus" : "Word Flow",
          description: option === "Focus" ? "Lines grow into focus and fade with distance." : "Words fill as they play as lines glide into view.",
        } : { value: option, label: option });
        const value = String(val);
        const displayValue = startup && val === null ? "checking?"
          : startup && val === "Unavailable" ? "unavailable"
          : options.find((option) => option.value === value)?.label ?? value;
        return <SettingsDropdown label={r.l} value={value} displayValue={displayValue} options={options}
          open={openDropdown === key} busy={busy} disabled={busy || (startup && startupMode === "Unavailable")}
          onOpenChange={(open) => setOpenDropdown((current) => open ? key : current === key ? null : current)}
          onSelect={(option) => updateSetting(key, option as SettingsState[typeof key])} />;
      }

      case "rng": {
        const min = r.min ?? 0;
        const max = r.max ?? 100;
        const numVal = typeof val === "number" ? val : min;
        const pct = ((numVal - min) / (max - min)) * 100;

        return (
          <div className="settings-rng">
            <input
              type="range"
              aria-label={r.l}
              min={min}
              max={max}
              step={r.s || 1}
              value={numVal}
              style={{ "--p": `${pct}%` } as React.CSSProperties}
              onChange={(e) => {
                const nextNum = Number(e.target.value);
                if (r.k) updateSetting(r.k, nextNum as any);
              }}
            />
            <output>{formatRangeValue(r, numVal)}</output>
          </div>
        );
      }

      case "time":
        return (
          <input
            type="time"
            className="settings-time"
            aria-label={r.l}
            value={String(val || "")}
            onChange={(e) => r.k && updateSetting(r.k, e.target.value as any)}
          />
        );

      case "btn": {
        const action = r.a;
        if (action !== "cache" && action !== "hist" && action !== "searchHistory") return null;
        return <button type="button" className="settings-btn" disabled={action === "cache" && (!isMyGo() || clearingCache)} onClick={() => setClearTarget(action)}>{r.b}</button>;
      }

      case "txt":
        return <span className="settings-txt">{r.v as string}</span>;

      default:
        return null;
    }
  };

  const renderRow = (r: SettingRowDef, idx: number) => {
    const dimmed = isDimmed(r.dep);
    if (r.t === "eq") return <Equalizer key={`${r.l}-${idx}`} presetsOpen={openDropdown === "equalizer"} onPresetsOpenChange={(open) => setOpenDropdown((current) => open ? "equalizer" : current === "equalizer" ? null : current)} />;
    if (r.t === "zoom") return <div className="settings-row settings-zoom-row" key={`${r.l}-${idx}`}><div><b>{r.l}</b>{r.d && <small>{r.d}</small>}</div><ZoomControl /></div>;
    return (
      <div className={`settings-row ${r.t === "dd" || r.t === "prog" ? "settings-row-select" : ""} ${dimmed ? "dim" : ""}`} key={`${r.l}-${idx}`}>
        <div>
          <b>{r.l}</b>
          {r.a === "cache" ? <small aria-live="polite">{!isMyGo() ? "available in the installed app"
            : cacheCount === "error" ? "couldn't load the saved song count"
            : cacheCount === null ? "counting saved songs"
            : `${cacheCount} ${cacheCount === 1 ? "song" : "songs"} saved`}</small> : r.d ? <small>{r.d}</small> : null}
        </div>
        {renderControl(r)}
      </div>
    );
  };

  const renderSearchResults = () => {
    const q = query.trim().toLowerCase();
    const matches: { title: string; rows: SettingRowDef[] }[] = [];

    Object.values(SETTINGS_SECTIONS).forEach((section) => {
      const matchedRows = section.g.flatMap((g) => g.r).filter((r) => {
        const text = `${r.l || ""} ${r.d || ""}`.toLowerCase();
        return text.includes(q);
      });
      if (matchedRows.length > 0) {
        matches.push({ title: section.t, rows: matchedRows });
      }
    });

    const matchesAbout = "about wisewave open source licenses".includes(q);
    if (!matches.length && !matchesAbout) {
      return <div className="settings-search-empty" role="status">no results found for &quot;{query.trim()}&quot;.</div>;
    }

    return (
      <div className="settings-in">
        {matchesAbout && <button className="settings-about-search" type="button" onClick={() => { setQuery(""); setActiveSection("about"); setShowLicenses(false); setShowLyricsSources(false); }}>About WiseWave <ChevronRight size={17} /></button>}
        {matches.map((item) => (
          <div key={item.title}>
            <h2>{item.title}</h2>
            <div className="settings-grp">
              {item.rows.map((row, i) => renderRow(row, i))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const currentSection = SETTINGS_SECTIONS[activeSection] || SETTINGS_SECTIONS.appearance;
  const HeaderIcon = query.trim() ? Search : NAV_ICONS[activeSection as keyof typeof NAV_ICONS] || Palette;
  const showHeaderContent = Boolean(query.trim()) || !["youtube", "spotify", "discord"].includes(activeSection);

  const discordPreviewData = useMemo(() => {
    const cover = track?.album_art_url ? preferredArtworkURL(track.album_art_url, 152) : "";
    return {
      titleText: track?.title || "nothing playing",
      artistText: track?.artist || null,
      artworkSrc: cover || (track ? "wisewave_logo" : ""),
      currentTimeText: track ? formatTime(currentPosition) : "--:--",
      totalTimeText: track ? formatTime(currentDuration) : "--:--",
    };
  }, [track, currentPosition, currentDuration]);

  const progressPercent = track && currentDuration > 0
    ? Math.min(100, Math.max(0, (currentPosition / currentDuration) * 100))
    : 0;
  const profileBadges = discordProfile ? discordBadges(discordProfile.public_flags) : [];

  return (
    <div className={`settings-overlay ${closing ? "settings-closing" : ""}`}>
    <div className="settings-app" role="dialog" aria-modal="true" aria-label="Settings">
      <aside className="settings-aside">
        <div className="settings-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            ref={searchRef}
            placeholder="Search settings"
            aria-label="Search settings"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <button className="settings-search-clear" type="button" aria-label="Clear settings search" onPointerDown={(event) => event.preventDefault()} onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={10} strokeWidth={3} /></button>}
        </div>

        <nav className="settings-nav" aria-label="Settings sections">
          {NAV_GROUPS.map(([header, ids]) => (
            <div key={header}>
              <h3>{header}</h3>
              {ids.map((id) => {
                const Icon = NAV_ICONS[id];
                return <button
                  type="button"
                  key={id}
                  className="settings-nav-item"
                  aria-current={!query.trim() && activeSection === id ? "page" : undefined}
                  onClick={() => {
                    setQuery("");
                    setActiveSection(id);
                    setShowLicenses(false);
                    setShowLyricsSources(false);
                    if (mainRef.current) mainRef.current.scrollTop = 0;
                  }}
                >
                  <span className={`settings-nav-icon is-${id}`} aria-hidden="true"><Icon size={18} /></span>
                  <span>{SETTINGS_SECTIONS[id]?.t}</span>
                </button>;
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="settings-body">
        <header className="settings-header">
          {showHeaderContent && <div className="settings-header-content"><span className="settings-header-icon" aria-hidden="true"><HeaderIcon size={18} /></span><strong>{query.trim() ? "Search" : showLicenses && activeSection === "about" ? showLyricsSources ? "Lyrics sources" : "Open source licenses" : currentSection.t}</strong></div>}
          <button className="settings-close" type="button" onClick={closeSettings} aria-label="Close settings"><X size={20} /></button>
        </header>
      <main className="settings-main player-scroll" ref={mainRef}>
        {query.trim() ? (
          renderSearchResults()
        ) : (
          <div className="settings-in">

            {activeSection === "about" && (showLicenses ? <div className="settings-about-licenses">
              {showLyricsSources ? <>
                <button className="settings-about-back" type="button" onClick={() => { setShowLyricsSources(false); if (mainRef.current) mainRef.current.scrollTop = 0; }}><ChevronLeft size={17} aria-hidden="true" />Open source licenses</button>
                <div className="settings-licenses-heading"><h1>Lyrics sources</h1><p>Sources and communities that provide lyrics in WiseWave.</p></div>
                <div className="settings-license-list settings-source-list">{Object.entries(LYRIC_SOURCES).map(([id, source]) => <a key={id} href={source.url} target="_blank" rel="noopener noreferrer"><span><strong>{source.name}</strong></span><ExternalLink size={17} /></a>)}</div>
              </> : <>
                <button className="settings-about-back" type="button" onClick={() => setShowLicenses(false)}><ChevronLeft size={17} aria-hidden="true" />About</button>
                <div className="settings-licenses-heading"><h1>Open source licenses</h1><p>Licenses and notices for included components.</p></div>
                <section className="settings-lyrics-credits" aria-labelledby="lyrics-credits-title">
                  <h2 id="lyrics-credits-title">Lyrics credits</h2>
                  <p>Thanks to the people and communities who provide lyrics for WiseWave.</p>
                  <button type="button" onClick={() => { setShowLyricsSources(true); if (mainRef.current) mainRef.current.scrollTop = 0; }}>See all sources <ChevronRight size={17} /></button>
                </section>
                <div className="settings-license-list">{LICENSES.map((entry) => <details key={entry.name}>
                  <summary><span><strong>{entry.name}</strong><small>{entry.license}</small></span><ChevronRight size={18} /></summary>
                  <pre>{entry.text}</pre>
                </details>)}</div>
              </>}
            </div> : <div className="settings-about">
              <section className="settings-update-card" aria-label="App updates">
                <div className="settings-update-info">
                  <strong>WiseWave <span className="settings-update-version">{appVersion}</span></strong>
                  <small aria-live="polite">{updateStatusText}</small>
                </div>
                <button className="settings-btn" type="button" disabled={!canCheckForUpdates || updateStatus === "unavailable" || openingUpdater} aria-label="Check for updates" aria-busy={openingUpdater} onClick={() => void checkForUpdates()}>
                  {openingUpdater ? <Classic aria-hidden="true" /> : <><RefreshCw size={16} aria-hidden="true" />Check for updates</>}
                </button>
              </section>
              <button type="button" onClick={() => { setShowLicenses(true); if (mainRef.current) mainRef.current.scrollTop = 0; }}><BookOpen size={21} /><span><strong>Open source licenses</strong><small>Licenses and notices for included components</small></span><ChevronRight size={19} /></button>
            </div>)}

            {currentSection.pre === "youtube" && <YouTubeConnection onImport={onImportYouTube} />}

            {currentSection.pre === "spotify" && <SpotifyConnection onImportSpotify={onImportSpotify} />}

            {currentSection.pre === "discord" && (
              <div className="settings-pv settings-dcp">
                <div className={`discord-account-heading${discordProfile ? " is-connected" : " is-disconnected"}`}><DiscordIcon size={16} /><span>{discordProfile ? "Connected" : "Disconnected"}</span></div>
                {privateListening ? <div className="discord-account-empty">turn off privacy mode to show your status</div> : discordProfile ? <div className="discord-profile-card">
                  <div className="discord-profile-identity">
                    {discordProfile.avatar ? <img className="discord-account-avatar" src={`https://cdn.discordapp.com/avatars/${encodeURIComponent(discordProfile.id)}/${encodeURIComponent(discordProfile.avatar)}.png?size=128`} alt="" referrerPolicy="no-referrer" /> : <span className="discord-account-avatar discord-account-avatar-fallback"><DiscordIcon size={28} /></span>}
                    <div className="discord-account-copy"><MarqueeText className="discord-profile-display-name">{discordProfile.global_name || discordProfile.username}</MarqueeText><MarqueeText className="discord-profile-username">@{discordProfile.username}</MarqueeText></div>
                  </div>
                  <div className={`discord-activity ${!st.dc ? "dim" : ""}`}>
                    <div className="discord-label">Listening to WiseWave</div>
                    <div className="discord-body">
                      {discordPreviewData.artworkSrc && discordPreviewData.artworkSrc !== "wisewave_logo" ? (
                        <img
                          className="discord-art"
                          src={discordPreviewData.artworkSrc}
                          alt=""
                          decoding="sync"
                          fetchPriority="high"
                          referrerPolicy="no-referrer"
                        />
                      ) : discordPreviewData.artworkSrc === "wisewave_logo" ? (
                        <img className="discord-art" src={appIcon} alt="" decoding="sync" fetchPriority="high" />
                      ) : (
                        <div className="discord-placeholder">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 18V5l12-2v13" />
                            <circle cx="6" cy="18" r="3" />
                            <circle cx="18" cy="16" r="3" />
                          </svg>
                        </div>
                      )}
                      <div className="discord-details">
                        <div className="discord-track">{discordPreviewData.titleText}</div>
                        {discordPreviewData.artistText && (
                          <div className="discord-artist">{discordPreviewData.artistText}</div>
                        )}
                        {track && (
                          <div className="discord-progress">
                            <span>{discordPreviewData.currentTimeText}</span>
                            <span className="discord-line" aria-hidden="true">
                              <i style={{ width: `${progressPercent}%` }} />
                            </span>
                            <span>{discordPreviewData.totalTimeText}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div> : <div className="discord-account-empty">{!st.dc ? "Discord activity is turned off in Presence settings." : "Open the Discord desktop app to show your profile here."}</div>}
              </div>
            )}

            {currentSection.g.map((group) => (
                <div key={group.h}>
                  <h2>{group.h}</h2>
                  <div className="settings-grp">
                    {group.r.map((row, i) => renderRow(row, i))}
                  </div>
                </div>
              ))}

          </div>
        )}
      </main>
      </div>
      {progressPickerOpen && (
        <div
          className={`settings-progress-picker${progressPickerClosing ? " closing" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="progress-style-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeProgressPicker();
          }}
        >
          <div className="settings-progress-panel">
            <header>
              <div>
                <h2 id="progress-style-title">Progress style</h2>
                <p>Choose your player timeline</p>
              </div>
              <button type="button" autoFocus aria-label="Close progress style picker" onClick={closeProgressPicker}>
                <X size={18} />
              </button>
            </header>
            <div className="settings-progress-grid">
              {PROGRESS_STYLES.map((option) => {
                const selected = readProgressStyle(st.progressStyle) === option;
                return (
                  <button
                    key={option}
                    type="button"
                    className={`settings-progress-card${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => {
                      updateSetting("progressStyle", option as ProgressStyle);
                      closeProgressPicker();
                    }}
                  >
                    <span className="settings-progress-card-preview">
                      <ProgressStylePreview style={option} playing={!st.motion} />
                      {selected && <Check size={18} className="settings-progress-check" aria-hidden="true" />}
                    </span>
                    <span className="settings-progress-card-label">{option}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {clearTarget && <DeleteConfirmation {...clearConfirmations[clearTarget]} confirmLabel="Clear" onCancel={() => setClearTarget(null)} onConfirm={confirmClear} />}
      <PlayerAlert message={note} onDismiss={dismissNote} />
    </div>
    </div>
  );
}
