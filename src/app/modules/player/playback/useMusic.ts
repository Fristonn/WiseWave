import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Discord, MediaSession, Music, Playback, TrayControl, events, type DiscordState, type Line, type MediaSessionState, type PlaybackState, type Track } from "../../../mygo";
import { artworkURL, hasArtworkURL } from "../../../shared/ui/Artwork";
import { readEqualizer, type EqualizerSettings } from "./equalizerSettings";

function parseDuration(duration?: string | number): number {
  if (typeof duration === "number" && duration > 0) return duration;
  if (!duration || typeof duration !== "string") return 0;
  const parts = duration.split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function readPlaybackSettings() {
  try { return JSON.parse(localStorage.getItem("wisewave-settings") || "{}"); }
  catch { return {}; }
}

function persistVolume(value: number) {
  try {
    const current = readPlaybackSettings();
    if (current.vol === value) return;
    const next = { ...current, vol: value };
    localStorage.setItem("wisewave-settings", JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("wisewave-settings-changed", { detail: next }));
    window.dispatchEvent(new Event("wisewave-settings-updated"));
  } catch {}
}

function readCurrentTrack(): Track | null {
  try {
    const raw = localStorage.getItem("wisewave-current-track");
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value && typeof (value as Track).id === "string" && typeof (value as Track).title === "string") {
      return value as Track;
    }
  } catch {}
  return null;
}

const collectionStateKey = "wisewave-playback-collection";

function readCollectionState(trackID: string): { tracks: Track[]; next: Track[] } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(collectionStateKey) || "null");
    const valid = (item: Track) => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.artist === "string";
    if (saved?.trackID !== trackID || !Array.isArray(saved.tracks) || !saved.tracks.length || !Array.isArray(saved.next) || !saved.tracks.every(valid) || !saved.next.every(valid)) return null;
    return { tracks: saved.tracks, next: saved.next };
  } catch { return null; }
}

function readHistory(): Track[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("wisewave-history") || "[]");
    return Array.isArray(value) ? value.filter((track): track is Track => typeof track?.id === "string" && typeof track?.title === "string" && typeof track?.artist === "string").slice(0, 30) : [];
  } catch { return []; }
}

function upcomingMixTracks(items: Track[], currentID: string, previous: Track[]): Track[] {
  const seen = new Set([...previous.slice(-20).map((item) => item.id), currentID]);
  const index = items.findIndex((item) => item.id === currentID);
  return items.slice(index + 1).filter((item) => {
    if (!item.id || seen.has(item.id) || !hasArtworkURL(item.album_art_url)) return false;
    seen.add(item.id);
    return true;
  });
}

export function useMusic() {
  const playbackVersion = useRef(0);
  const seekVersionRef = useRef(0);
  const seekPending = useRef(false);
  const seekChain = useRef<Promise<void>>(Promise.resolve());
  const [seekVersion, setSeekVersion] = useState(0);
  const restoredTrack = useRef<Track | null>(null);
  const pendingRestore = useRef<{ id: string; position: number } | null>(null);
  const restorePreparation = useRef<Promise<boolean> | null>(null);
  const volumeChain = useRef<Promise<void>>(Promise.resolve());
  const [track, setTrack] = useState<Track | null>(null);
  const trackRef = useRef(track);
  trackRef.current = track;
  const [queue, setQueue] = useState<Track[]>([]);
  const [history, setHistory] = useState<Track[]>(readHistory);
  const historyRef = useRef(history);
  historyRef.current = history;
  const previousStackRef = useRef<Track[]>([]);
  const forwardStackRef = useRef<Track[]>([]);
  const clearHistory = () => {
    try {
      localStorage.setItem("wisewave-history", "[]");
      historyRef.current = [];
      historyAddedRef.current = track?.id ?? null;
      setHistory([]);
      return true;
    } catch {
      return false;
    }
  };
  const [popular, setPopular] = useState<Track[]>([]);
  const [forYou, setForYou] = useState<Track[]>([]);
  const [preserveForYou, setPreserveForYou] = useState(() => {
    try { return localStorage.getItem("wisewave-preserve-for-you") === "true"; }
    catch { return false; }
  });
  const forYouSequence = useRef(false);
  const collectionSequence = useRef(false);
  const collectionTracks = useRef<Track[]>([]);
  const [playing, setPlaying] = useState(false);
  const [trackLoading, setTrackLoading] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const bufferStall = useRef<{ position: number; since: number } | null>(null);
  const [position, setPosition] = useState(0);
  const positionRef = useRef(position);
  positionRef.current = position;
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => { const value = readPlaybackSettings().vol; return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100; });
  const [muted, setMuted] = useState(false);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);
  volumeRef.current = volume;
  mutedRef.current = muted;
  const [repeatMode, setRepeatMode] = useState<"off" | "track" | "queue">("off");
  const repeatModeRef = useRef(repeatMode);
  repeatModeRef.current = repeatMode;
  const repeat = repeatMode === "track";
  const setRepeat = (enabled: boolean) => setRepeatMode(enabled ? "track" : "off");
  const cycleRepeat = () => setRepeatMode((mode) => mode === "off" ? "track" : mode === "track" ? "queue" : "off");
  const [autoplay, setAutoplay] = useState(() => readPlaybackSettings().auto !== false);
  const [playbackSettings, setPlaybackSettings] = useState(readPlaybackSettings);
  const [upNext, setUpNext] = useState<Track[]>([]);
  const upNextRef = useRef(upNext);
  upNextRef.current = upNext;
  const [mixTracks, setMixTracks] = useState<Track[]>([]);
  const [mixLoading, setMixLoading] = useState(false);
  const mixTracksRef = useRef(mixTracks);
  mixTracksRef.current = mixTracks;
  const playbackListRef = useRef<Track[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const nextPending = useRef<number | null>(null);
  const playbackControlPending = useRef(false);
  const playbackControlVersion = useRef(0);
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;
  const relatedRef = useRef<{ id: string; tracks: Promise<Track[]> } | null>(null);
  const [error, setError] = useState("");
  const [lyrics, setLyrics] = useState<Line[]>([]);
  const [lyricsCredit, setLyricsCredit] = useState<import("../../../mygo").Record | null>(null);
  const [plainLyrics, setPlainLyrics] = useState("");
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const historyAddedRef = useRef<string | null>(null);
  const playTimeRef = useRef<{ trackId: string; listenedSec: number }>({ trackId: "", listenedSec: 0 });
  const forYouLoadedRef = useRef(false);
  const forYouBusyRef = useRef(false);
  const forYouMountedRef = useRef(false);
  const [forYouRetry, setForYouRetry] = useState(0);
  const listensSinceForYouRef = useRef(0);
  const lastCountedHistoryIdRef = useRef<string | null>(history[0]?.id ?? null);
  const refreshForYouOnTrackRef = useRef(false);
  const forYouPendingTrackRef = useRef<string | null>(null);

  const togglePreserveForYou = () => {
    const next = !preserveForYou;
    setPreserveForYou(next);
    try { localStorage.setItem("wisewave-preserve-for-you", String(next)); }
    catch { setError("couldn't save your for you setting"); }
  };

  const [playbackState, setPlaybackState] = useState<PlaybackState | null>(null);
  const [discordEnabled, setDiscordEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem("wisewave-discord-enabled") === "true"; }
    catch { return false; }
  });

  const [privateListening, setPrivateListening] = useState(() => {
    try { return localStorage.getItem("wisewave-private-listening") === "true"; }
    catch { return false; }
  });
  const privateListeningRef = useRef(privateListening);
  privateListeningRef.current = privateListening;
  const discordSync = useRef<Promise<void>>(Promise.resolve());
  const discordVersion = useRef(0);
  const togglePrivateListening = () => {
    const next = !privateListeningRef.current;
    privateListeningRef.current = next;
    setPrivateListening(next);
    try { localStorage.setItem("wisewave-private-listening", String(next)); }
    catch { setError("couldn't save your private listening setting"); }
  };

  const toggleDiscord = (enabled: boolean) => {
    setDiscordEnabled(enabled);
    try { localStorage.setItem("wisewave-discord-enabled", String(enabled)); }
    catch {}
  };

  useEffect(() => { Music.popular().then(setPopular).catch(() => setError("couldn't load popular songs")); }, []);

  useEffect(() => {
    const headId = history[0]?.id ?? null;
    if (!history.length) {
      lastCountedHistoryIdRef.current = null;
      listensSinceForYouRef.current = 0;
      refreshForYouOnTrackRef.current = false;
      forYouPendingTrackRef.current = null;
      forYouLoadedRef.current = false;
      setForYou([]);
      return;
    }
    if (headId && headId !== lastCountedHistoryIdRef.current) {
      lastCountedHistoryIdRef.current = headId;
      if (forYouLoadedRef.current) {
        listensSinceForYouRef.current += 1;
        if (listensSinceForYouRef.current >= 5) {
          refreshForYouOnTrackRef.current = true;
          forYouPendingTrackRef.current = trackRef.current?.id ?? null;
        }
      }
    }
  }, [history]);

  useEffect(() => { forYouMountedRef.current = true; return () => { forYouMountedRef.current = false; }; }, []);

  useEffect(() => {
    let active = true;
    const pendingRefresh = refreshForYouOnTrackRef.current;
    const stillOnPendingTrack = pendingRefresh && forYouPendingTrackRef.current != null && track?.id === forYouPendingTrackRef.current;
    const shouldLoad = (!forYouLoadedRef.current || pendingRefresh) && !stillOnPendingTrack;
    if (!shouldLoad || forYouBusyRef.current) return;

    const seeds: Track[] = [];
    const seedIds = new Set<string>();
    const pushSeed = (item?: Track | null) => {
      if (!item?.id || seedIds.has(item.id) || !hasArtworkURL(item.album_art_url)) return;
      seedIds.add(item.id);
      seeds.push(item);
    };
    for (const item of history) {
      pushSeed(item);
      if (seeds.length >= 8) break;
    }
    if (seeds.length < 8) pushSeed(track);
    if (!seeds.length) {
      setForYou([]);
      return;
    }

    forYouBusyRef.current = true;
    const results: PromiseSettledResult<Track[]>[] = new Array(seeds.length);
    let nextSeed = 0;
    const load = async () => {
      while (active && nextSeed < seeds.length) {
        const index = nextSeed++;
        try { results[index] = { status: "fulfilled", value: await Music.related(seeds[index].id) }; }
        catch (reason) { results[index] = { status: "rejected", reason }; }
      }
    };
    Promise.all(Array.from({ length: Math.min(3, seeds.length) }, load)).then(() => {
      if (!active) return;
      const seen = new Set<string>([track?.id, ...history.map((item) => item.id)].filter(Boolean) as string[]);
      const buckets = results.map((result) => {
        if (result.status !== "fulfilled") return [] as Track[];
        return result.value.filter((item) => item.id && !seen.has(item.id) && hasArtworkURL(item.album_art_url));
      });
      const tracks: Track[] = [];
      const cursors = buckets.map(() => 0);
      while (tracks.length < 96) {
        let added = false;
        for (let index = 0; index < buckets.length; index++) {
          const bucket = buckets[index];
          while (cursors[index] < bucket.length) {
            const item = bucket[cursors[index]++];
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            tracks.push(item);
            added = true;
            break;
          }
          if (tracks.length >= 96) break;
        }
        if (!added) break;
      }
      setForYou(tracks);
      forYouLoadedRef.current = true;
      refreshForYouOnTrackRef.current = false;
      forYouPendingTrackRef.current = null;
      listensSinceForYouRef.current = 0;
    }).finally(() => {
      forYouBusyRef.current = false;
      if (!active && forYouMountedRef.current) setForYouRetry((value) => value + 1);
    });
    return () => { active = false; };
  }, [history, track?.id, forYouRetry]);

  const play = useCallback((item: Track, list: Track[] = [item], options?: { fromHistory?: boolean; forYou?: boolean; collection?: boolean; continueCollection?: boolean }) => {
    const current = trackRef.current;
    const playList = list.length ? list : [item];
    const index = Math.max(0, playList.findIndex((entry) => entry.id === item.id));
    if (!options?.fromHistory) forYouSequence.current = options?.forYou === true;
    if (!options?.fromHistory) collectionSequence.current = options?.collection === true;
    if (options?.collection && !options.continueCollection) collectionTracks.current = playList;
    if (!options?.fromHistory) {
      if (current && current.id !== item.id) {
        previousStackRef.current = [...previousStackRef.current, current].slice(-50);
      }
      forwardStackRef.current = [];
      playbackListRef.current = playList;
    }
    playbackVersion.current++;
    pendingRestore.current = null;
    seekVersionRef.current += 1;
    setSeekVersion(seekVersionRef.current);
    seekPending.current = false;
    historyAddedRef.current = null;
    playTimeRef.current = { trackId: item.id, listenedSec: 0 };
    setTrackLoading(true);
    setTrack({ ...item });
    setPlaying(true);
    setPosition(0);
    setDuration(item.duration_seconds || parseDuration(item.duration) || 0);
    if (!options?.fromHistory) {
      upNextRef.current = playList.slice(index + 1);
      setUpNext(upNextRef.current);
    }
    setError("");
    if (readPlaybackSettings().resume !== false) {
      try {
        localStorage.setItem("wisewave-current-track", JSON.stringify(item));
        if (collectionSequence.current) localStorage.setItem(collectionStateKey, JSON.stringify({ trackID: item.id, tracks: collectionTracks.current, next: upNextRef.current }));
        else localStorage.removeItem(collectionStateKey);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (track && playbackSettings.resume !== false) {
      try { localStorage.setItem("wisewave-current-track", JSON.stringify(track)); } catch {}
    }
  }, [track, playbackSettings.resume]);

  useEffect(() => {
    let active = true;
    const version = playbackVersion.current;
    void Playback.state().then((state) => {
      if (!active || playbackVersion.current !== version) return;
      const cached = readPlaybackSettings().resume === false ? null : readCurrentTrack();
      const restoreCollection = (current: Track) => {
        if (readPlaybackSettings().resume === false) return;
        const saved = readCollectionState(current.id);
        if (!saved) return;
        collectionSequence.current = true;
        collectionTracks.current = saved.tracks;
        playbackListRef.current = saved.tracks;
        upNextRef.current = saved.next;
        setUpNext(saved.next);
      };
      if (!state.track_id) {
        if (!cached) return;
        restoreCollection(cached);
        const savedPosition = Number(localStorage.getItem("wisewave-current-position"));
        const position = Number.isFinite(savedPosition) ? Math.max(0, savedPosition) : 0;
        pendingRestore.current = { id: cached.id, position };
        restoredTrack.current = cached;
        setTrack(cached);
        setPosition(position);
        setDuration(cached.duration_seconds || parseDuration(cached.duration));
        setTrackLoading(true);
        const preparation = Playback.prepare(cached.id, position).then(async () => {
          const restored = pendingRestore.current;
          if (active && playbackVersion.current === version && restored?.id === cached.id) {
            if (restored.position !== position) await Playback.seek(restored.position);
            if (active && playbackVersion.current === version && pendingRestore.current === restored) pendingRestore.current = null;
          }
          return true;
        }).catch(() => {
          if (active && playbackVersion.current === version) setError("couldn't restore your last song. try playing it again");
          return false;
        }).finally(() => {
          if (restorePreparation.current === preparation) restorePreparation.current = null;
          if (active && playbackVersion.current === version) setTrackLoading(false);
        });
        restorePreparation.current = preparation;
        return;
      }
      const current = (cached && cached.id === state.track_id)
        ? cached
        : readHistory().find((item) => item.id === state.track_id);
      if (!current) return;
      restoreCollection(current);
      restoredTrack.current = current;
      setTrack(current);
      setPlaying(state.playing);
      setPosition(state.position);
      setDuration(state.duration || current.duration_seconds || parseDuration(current.duration));
      setPlaybackState(state);
    }).catch(() => { if (active && playbackVersion.current === version) setError("couldn't check playback"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!track || playbackSettings.resume === false) return;
    const save = () => { try { localStorage.setItem("wisewave-current-position", String(positionRef.current)); } catch {} };
    save();
    const timer = window.setInterval(save, 3000);
    window.addEventListener("pagehide", save);
    return () => { window.clearInterval(timer); window.removeEventListener("pagehide", save); };
  }, [track?.id, playing, seekVersion, playbackSettings.resume]);

  useEffect(() => {
    if (playbackSettings.hist === false) {
      if (history.length) setHistory([]);
      try { localStorage.setItem("wisewave-history", "[]"); } catch {}
      return;
    }
    try { localStorage.setItem("wisewave-history", JSON.stringify(history)); }
    catch { setError("couldn't save your recently played songs"); }
  }, [history, playbackSettings.hist]);

  useEffect(() => {
    if (!track) return;
    bufferStall.current = null;
    setBuffering(false);
    if (restoredTrack.current === track) {
      restoredTrack.current = null;
      return;
    }
    let active = true;
    void seekChain.current
      .then(() => {
        if (!active) return;
        return Playback.play(track.id);
      })
      .then(() => {
        if (active) {
          setPlaying(true);
          void Playback.state().then((state) => { if (active) setPlaybackState(state); }).catch(() => {});
          void Playback.volume(mutedRef.current ? 0 : volumeRef.current / 100);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setPlaying(false);
          setError(error instanceof Error ? error.message : "couldn't play this song");
        }
      })
      .finally(() => {
        if (active) setTrackLoading(false);
      });

    return () => {
      active = false;
    };
  }, [track]);
  useEffect(() => {
    if (!track) { setLyrics([]); setPlainLyrics(""); setLyricsCredit(null); return; }
    let active = true;
    setLyrics([]); setPlainLyrics(""); setLyricsCredit(null); setLyricsLoading(true);
    Music.lyrics(track.title, track.artist, track.album, Math.round(track.duration_seconds || duration || 0), track.id).then((result) => {
      if (active) { setLyrics(result?.lines || []); setPlainLyrics(result?.plain_lyrics || ""); setLyricsCredit(result); }
    }).catch(() => { if (active) { setLyrics([]); setPlainLyrics(""); setLyricsCredit(null); } }).finally(() => { if (active) setLyricsLoading(false); });
    return () => { active = false; };
  }, [track?.id, track?.title, track?.artist, track?.album]);

  useEffect(() => {
    if (preserveForYou && mixTracksRef.current.length) return;
    if (!track) {
      setMixTracks([]);
      setMixLoading(false);
      return;
    }
    mixTracksRef.current = [];
    setMixTracks([]);
    setMixLoading(true);
    let active = true;
    const req = Music.related(track.id);
    relatedRef.current = { id: track.id, tracks: req };
    req.then((tracks) => {
      if (active) {
        const items = upcomingMixTracks(tracks, track.id, previousStackRef.current);
        mixTracksRef.current = items;
        setMixTracks(items);
      }
    }).catch(() => {
      if (active) setMixTracks([]);
    }).finally(() => { if (active) setMixLoading(false); });
    return () => { active = false; };
  }, [track?.id, preserveForYou]);

  const playQueued = (index: number) => {
    const items = queueRef.current;
    if (!items[index]) return;
    queueRef.current = items.slice(index + 1);
    setQueue(queueRef.current);
    play(items[index], [items[index], ...upNextRef.current.filter((item) => item.id !== items[index].id)], { forYou: forYouSequence.current, collection: collectionSequence.current, continueCollection: true });
  };
  const next = async () => {
    if (trackLoading || playbackControlPending.current) return;
    const version = playbackVersion.current;
    const mode = repeatModeRef.current;
    const controlVersion = playbackControlVersion.current;
    if (forwardStackRef.current.length) {
      const items = forwardStackRef.current;
      const nextTrack = items[items.length - 1];
      forwardStackRef.current = items.slice(0, -1);
      const current = trackRef.current;
      if (current) previousStackRef.current = [...previousStackRef.current, current].slice(-50);
      play(nextTrack, [nextTrack], { fromHistory: true });
      return;
    }
    if (queueRef.current.length) {
      if (mode === "queue" && track) {
        const items = queueRef.current;
        queueRef.current = [...items.slice(1), track];
        setQueue(queueRef.current);
        play(items[0], [items[0], ...upNextRef.current], { collection: collectionSequence.current, forYou: forYouSequence.current, continueCollection: true });
        return;
      }
      playQueued(0);
      return;
    }
    if (collectionSequence.current && upNextRef.current.length) {
      play(upNextRef.current[0], upNextRef.current, { collection: true, continueCollection: true });
      return;
    }
    if (collectionSequence.current && mode === "queue" && track) {
      const list = collectionTracks.current.length ? collectionTracks.current : [track];
      play(list[0], list, { collection: true, continueCollection: true });
      return;
    }
    if (collectionSequence.current && !autoplay) return;
    if (preserveForYou && autoplay && mixTracksRef.current.length) {
      const recommendations = upcomingMixTracks(mixTracksRef.current, trackRef.current?.id || "", previousStackRef.current);
      if (recommendations.length) play(recommendations[0], recommendations, { forYou: true });
      return;
    }
    if (upNextRef.current.length) {
      play(upNextRef.current[0], upNextRef.current, { forYou: forYouSequence.current });
      return;
    }
    if (autoplay && track) {
      const recommendations = upcomingMixTracks(mixTracksRef.current, track.id, previousStackRef.current);
      const nextTrack = recommendations[0];
      if (nextTrack) {
        play(nextTrack, recommendations, { forYou: true });
        return;
      }
      if (recommendations.length) {
        upNextRef.current = [];
        setUpNext([]);
      }
    }
    if (upNextRef.current.length) {
      play(upNextRef.current[0], upNextRef.current);
      return;
    }
    if (mode === "queue" && track) {
      const list = playbackListRef.current.length ? playbackListRef.current : [track];
      play(list[0], list);
      return;
    }
    if (!autoplay || !track) return;
    if (preserveForYou && mixTracksRef.current.length) return;
    if (nextPending.current === playbackVersion.current) return;
    nextPending.current = version;
    try {
      const tracks = await (relatedRef.current?.id === track.id ? relatedRef.current.tracks : Music.related(track.id));
      if (version !== playbackVersion.current || controlVersion !== playbackControlVersion.current || playbackControlPending.current || !autoplayRef.current) return;
      if (queueRef.current.length) { playQueued(0); return; }
      if (upNextRef.current.length) { play(upNextRef.current[0], upNextRef.current); return; }
      if (repeatModeRef.current === "queue" && track) {
        const list = playbackListRef.current.length ? playbackListRef.current : [track];
        play(list[0], list);
        return;
      }
      const ready = upcomingMixTracks(mixTracksRef.current, track.id, previousStackRef.current);
      if (ready.length) {
        play(ready[0], ready, { forYou: true });
        return;
      }
      const unique = upcomingMixTracks(tracks, track.id, previousStackRef.current);
      if (unique.length) {
        mixTracksRef.current = unique;
        setMixTracks(unique);
        play(unique[0], unique, { forYou: true });
      }
      else setError("no related songs found");
    } catch {
      if (version === playbackVersion.current) setError("couldn't load the next song");
    } finally { if (nextPending.current === version) nextPending.current = null; }
  };
  const shuffle = () => {
    if (queueRef.current.length > 1) {
      const result = [...queueRef.current];
      for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
      queueRef.current = result;
      setQueue(result);
      return;
    }
    if (collectionSequence.current) {
      const result = [...upNextRef.current];
      for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
      upNextRef.current = result;
      setUpNext(result);
      const currentIndex = collectionTracks.current.findIndex((item) => item.id === trackRef.current?.id);
      collectionTracks.current = [...collectionTracks.current.slice(0, currentIndex + 1), ...result];
      if (trackRef.current && readPlaybackSettings().resume !== false) {
        try { localStorage.setItem(collectionStateKey, JSON.stringify({ trackID: trackRef.current.id, tracks: collectionTracks.current, next: result })); } catch {}
      }
      return;
    }
    const queued = queueRef.current.length > 1;
    const result = [...(queued ? queueRef.current : upNextRef.current.length > 1 ? upNextRef.current : mixTracksRef.current.filter((item) => item.id !== trackRef.current?.id))];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    if (queued) {
      queueRef.current = result;
      setQueue(result);
    } else {
      forYouSequence.current = true;
      upNextRef.current = result;
      setUpNext(result);
      mixTracksRef.current = result;
      setMixTracks(result);
    }
  };
  const toggle = async () => {
    if (!track || playbackControlPending.current) return;
    playbackControlPending.current = true;
    playbackControlVersion.current++;
    const version = playbackVersion.current;
    try {
      if (playing) await Playback.pause();
      else if (pendingRestore.current?.id === track.id) {
        const restored = pendingRestore.current;
        setTrackLoading(true);
        try {
          const prepared = await restorePreparation.current;
          if (version !== playbackVersion.current) return;
          if (!prepared) {
            await Playback.prepare(track.id, restored.position);
            if (version !== playbackVersion.current) return;
            pendingRestore.current = null;
          }
          await Playback.volume(mutedRef.current ? 0 : volumeRef.current / 100);
          await Playback.resume();
        } finally {
          if (version === playbackVersion.current) setTrackLoading(false);
        }
      } else await Playback.resume();
      if (version === playbackVersion.current) setPlaying(!playing);
    } catch {
      if (version === playbackVersion.current) setError("playback controls aren't working right now");
    } finally {
      playbackControlPending.current = false;
    }
  };
  const toggleMute = () => { const next = !mutedRef.current; mutedRef.current = next; setMuted(next); void Playback.volume(next ? 0 : volumeRef.current / 100).catch(() => setError("couldn't change the volume")); };
  const seek = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    seconds = Math.max(0, Math.min(seconds, duration > 0 ? duration : 86400));
    const version = ++seekVersionRef.current;
    const trackVersion = playbackVersion.current;
    seekPending.current = true;
    setSeekVersion(version);
    setPosition(seconds);
    if (pendingRestore.current) {
      pendingRestore.current.position = seconds;
      seekPending.current = false;
      return;
    }
    seekChain.current = seekChain.current.then(async () => {
      if (version !== seekVersionRef.current || trackVersion !== playbackVersion.current) return;
      try { await Playback.seek(seconds); }
      catch { if (version === seekVersionRef.current) setError("couldn't skip to that part of the song"); }
      finally { if (version === seekVersionRef.current) seekPending.current = false; }
    });
  };
  const previous = () => {
    const current = trackRef.current;
    if (!current || trackLoading || playbackControlPending.current) return;
    const stack = previousStackRef.current;
    const prev = stack[stack.length - 1];
    if (!prev) return;
    previousStackRef.current = stack.slice(0, -1);
    forwardStackRef.current = [...forwardStackRef.current, current].slice(-50);
    play(prev, [prev], { fromHistory: true });
  };
  const changeVolume = (value: number) => {
    const next = Math.max(0, Math.min(100, value));
    volumeRef.current = next; mutedRef.current = false; setVolume(next); setMuted(false);
    persistVolume(next);
    volumeChain.current = volumeChain.current.then(() => Playback.volume(next / 100)).catch(() => setError("couldn't change the volume"));
  };

  const resetAudioEngine = async () => {
    if (!track) return;
    const currentTrack = track;
    const currentPos = position;
    try {
      await Playback.reset();
      setPlaying(true);
      setError("");
      void Playback.state().then(setPlaybackState).catch(() => {});
    } catch {
      try {
        await Playback.play(currentTrack.id);
        if (currentPos > 0) await Playback.seek(currentPos);
        setPlaying(true);
        setError("");
        void Playback.state().then(setPlaybackState).catch(() => {});
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "couldn't restart the audio");
      }
    }
  };

  const stopPlayback = () => {
    playbackControlVersion.current++;
    void Playback.stop().catch(() => {});
    setPlaying(false);
    setPosition(0);
    setPlaybackState((current) => current ? { ...current, playing: false, position: 0, buffer_ahead: 0 } : null);
  };


  useEffect(() => {
    if (!track || trackLoading) return;
    let active = true;
    let pending = false;
    const playVersion = playbackVersion.current;
    const timer = window.setInterval(() => {
      const version = seekVersionRef.current;
      const controlVersion = playbackControlVersion.current;
      if (seekPending.current || pending || playbackVersion.current !== playVersion) return;
      pending = true;
      void Playback.state().then((state) => {
        if (!active || playbackControlPending.current || controlVersion !== playbackControlVersion.current || playbackVersion.current !== playVersion || seekPending.current || version !== seekVersionRef.current || state.track_id !== track.id) return;
        if (playing && state.playing && state.buffering && !state.error) {
          const stalled = bufferStall.current;
          if (!stalled || Math.abs(state.position - stalled.position) > 0.01) {
            bufferStall.current = { position: state.position, since: performance.now() };
            setBuffering(false);
          } else if (performance.now() - stalled.since >= 500) {
            setBuffering(true);
          }
        } else {
          bufferStall.current = null;
          setBuffering(false);
        }
        startTransition(() => {
          if (state.duration > 0) setDuration(state.duration);
          setPosition(state.position);
          setPlaybackState(state);
        });

        if (playTimeRef.current.trackId !== track.id) {
          playTimeRef.current = { trackId: track.id, listenedSec: 0 };
        }
        if (playing && state.playing) {
          playTimeRef.current.listenedSec += 0.25;
        }

        const totalDuration = state.duration > 0 ? state.duration : (track.duration_seconds || parseDuration(track.duration) || 0);
        if (playbackSettings.hist !== false && !privateListening && totalDuration > 0 && historyAddedRef.current !== track.id) {
          const halfDuration = totalDuration * 0.5;
          if (state.position >= halfDuration && playTimeRef.current.listenedSec >= Math.min(halfDuration * 0.8, halfDuration)) {
            historyAddedRef.current = track.id;
            setHistory((previous) => [track, ...previous.filter((entry) => entry.id !== track.id)].slice(0, 30));
          }
        }

        if (playing && !state.playing && !playbackControlPending.current) {
          setPlaying(false);
          if (state.error) setError(state.error);
          else if (totalDuration > 0 && state.position >= totalDuration - 0.5) {
            if (repeat) {
              seek(0);
              void seekChain.current.then(async () => {
                if (playbackVersion.current !== playVersion || controlVersion !== playbackControlVersion.current) return;
                await Playback.resume();
                if (playbackVersion.current === playVersion && controlVersion === playbackControlVersion.current) setPlaying(true);
              }).catch(() => { if (playbackVersion.current === playVersion) setError("couldn't repeat this song"); });
            } else void next();
          }
        }
      }).catch(() => { if (active) setError("couldn't check playback"); }).finally(() => { pending = false; });
    }, 250);
    return () => { active = false; window.clearInterval(timer); };
  }, [track, playing, trackLoading, repeat, repeatMode, queue, upNext, autoplay, forYou, popular, playbackSettings.hist, privateListening]);
  useEffect(() => {
    void TrayControl.update({ hasTrack: Boolean(track), playing, hasNext: Boolean(track && (queue.length || upNext.length || forwardStackRef.current.length || repeatMode === "queue" || autoplay)), muted }).catch(() => setError("tray controls aren't working right now"));
  }, [track, playing, queue.length, upNext.length, repeatMode, autoplay, muted]);

  useEffect(() => {
    const recommendation = upcomingMixTracks(mixTracks, track?.id || "", previousStackRef.current)[0];
    const nextID = forwardStackRef.current.at(-1)?.id || queue[0]?.id || (collectionSequence.current
      ? upNext[0]?.id || (repeatMode === "queue" ? collectionTracks.current[0]?.id : autoplay ? recommendation?.id : undefined)
      : preserveForYou && autoplay && mixTracks.length ? recommendation?.id : upNext[0]?.id || (autoplay ? recommendation?.id : undefined));
    void Playback.prefetch(playing && !trackLoading ? nextID || "" : "").catch(() => setError("couldn't get the next song ready"));
  }, [playing, trackLoading, track?.id, queue[0]?.id, upNext, autoplay, mixTracks, forYou, popular, repeatMode, preserveForYou]);

  useEffect(() => {
    const handleSettingsUpdate = () => {
      const next = readPlaybackSettings();
      setPlaybackSettings(next);
    };
    window.addEventListener("wisewave-settings-updated", handleSettingsUpdate);
    window.addEventListener("storage", handleSettingsUpdate);
    return () => {
      window.removeEventListener("wisewave-settings-updated", handleSettingsUpdate);
      window.removeEventListener("storage", handleSettingsUpdate);
    };
  }, []);

  useEffect(() => {
    void TrayControl.setWindowPreferences(playbackSettings.tray !== false, playbackSettings.mini === true).catch(() => setError("couldn't save your window settings"));
  }, [playbackSettings.tray, playbackSettings.mini]);

  useEffect(() => {
    void Playback.setNormalize(playbackSettings.norm === true).catch(() => setError("couldn't update volume normalization"));
  }, [playbackSettings.norm]);

  useEffect(() => {
    let active = true;
    let busy = false;
    let pending: EqualizerSettings | null = readEqualizer();
    const apply = async () => {
      if (busy) return;
      busy = true;
      while (active && pending) {
        const value = pending;
        pending = null;
        try { await Playback.setEqualizerBands(value.enabled, value.gains); }
        catch { if (active) setError("couldn't update the equalizer"); }
      }
      busy = false;
    };
    const change = (event: Event) => { pending = (event as CustomEvent<EqualizerSettings>).detail; void apply(); };
    window.addEventListener("wisewave-equalizer-changed", change);
    void apply();
    return () => { active = false; window.removeEventListener("wisewave-equalizer-changed", change); };
  }, []);

  useEffect(() => {
    void Playback.volume(volumeRef.current / 100).catch(() => setError("couldn't set the starting volume"));
  }, []);

  const effectiveDuration = Math.round(duration || track?.duration_seconds || parseDuration(track?.duration) || 0);

  useEffect(() => {
    const version = ++discordVersion.current;
    const enabled = discordEnabled && !privateListening;
    const sync = (state?: DiscordState) => {
      discordSync.current = discordSync.current.then(async () => {
        if (version !== discordVersion.current) return;
        await Discord.setEnabled(enabled);
        if (enabled && state && version === discordVersion.current) await Discord.update(state);
      }).catch(() => { if (version === discordVersion.current) setError("couldn't update your discord status"); });
    };
    if (!enabled) { sync(); return; }
    if (!track) {
      sync({ track_id: "", title: "", artist: "", artist_id: "", artwork_url: "", position: 0, duration: 0, seek_version: 0, playing: false });
      return;
    }

    if (!playing) {
      sync({
        track_id: "",
        title: "",
        artist: "",
        artist_id: "",
        artwork_url: "",
        position: 0,
        duration: 0,
        seek_version: 0,
        playing: false,
      });
      return;
    }

    const squareArt = track.album_art_url ? artworkURL(track.album_art_url, 600) : "";
    const artistParts = track.artist.split(/\s*(?:,|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring)\s+)\s*/i).map((n) => n.trim()).filter(Boolean);
    const isSingle = artistParts.length === 1;

    sync({
      track_id: track.id,
      title: track.title,
      artist: track.artist,
      artist_id: isSingle ? (track.artist_id || "") : "",
      artwork_url: squareArt || "wisewave_logo",
      position,
      duration: effectiveDuration,
      seek_version: seekVersionRef.current,
      playing,
    });
  }, [discordEnabled, privateListening, track?.id, track?.album_art_url, playing, position, effectiveDuration, seekVersionRef.current]);

  useEffect(() => {
    const handleBeforeUnload = () => { void Discord.close().catch(() => {}); };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      void Discord.close().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!track) {
      void MediaSession.clear().catch(() => {});
      return;
    }
    const squareArt = track.album_art_url ? artworkURL(track.album_art_url, 600) : "";
    const state: MediaSessionState = {
      track_id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album || "",
      artwork_url: squareArt,
      position,
      duration: effectiveDuration,
      playing,
      can_next: queue.length > 0 || upNext.length > 0 || repeatMode === "queue" || autoplay,
      can_previous: true,
    };
    void MediaSession.update(state).catch(() => {});
  }, [track?.id, track?.title, track?.artist, track?.album, track?.album_art_url, playing, seekVersion, effectiveDuration, queue.length, upNext.length, repeatMode, autoplay]);

  useEffect(() => () => { void MediaSession.clear().catch(() => {}); }, []);

  const actionsRef = useRef({ toggle, next, previous, toggleMute, playing });
  actionsRef.current = { toggle, next, previous, toggleMute, playing };
  useEffect(() => events.trayAction.on((action) => {
    if (action === "toggle") actionsRef.current.toggle();
    else if (action === "next") actionsRef.current.next();
    else if (action === "mute") actionsRef.current.toggleMute();
  }), []);
  useEffect(() => events.mediaAction.on((action) => {
    if (action === "play") {
      if (!actionsRef.current.playing) actionsRef.current.toggle();
    } else if (action === "pause") {
      if (actionsRef.current.playing) actionsRef.current.toggle();
    } else if (action === "toggle") actionsRef.current.toggle();
    else if (action === "next") actionsRef.current.next();
    else if (action === "previous") actionsRef.current.previous();
    else if (action === "seek") {
      void Playback.state().then((state) => {
        if (state?.position != null) setPosition(state.position);
      }).catch(() => {});
    }
  }), []);
  return { seek, seekVersion, changeVolume, track, trackLoading, buffering, history, clearHistory, popular, forYou, preserveForYou, togglePreserveForYou, queue, upNext, mixTracks, mixLoading, playing, position, duration, volume, muted, repeat, repeatMode, cycleRepeat, autoplay, error, lyrics, plainLyrics, lyricsCredit, lyricsLoading, playbackState, discordEnabled, toggleDiscord, privateListening, togglePrivateListening, resetAudioEngine, stopPlayback, play, playQueued, previous, next, shuffle, toggle, toggleMute, setQueue, setError, setPlaying, setPosition, setDuration, setVolume, setRepeat, setAutoplay };
}
