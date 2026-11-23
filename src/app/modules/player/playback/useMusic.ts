import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Discord, MediaSession, Music, Playback, TrayControl, events, type DiscordState, type Line, type MediaSessionState, type PlaybackState, type Record as LyricsRecord, type Track } from "../../../mygo";
import { artworkURL, hasArtworkURL } from "../../../shared/ui/Artwork";
import { feedbackText } from "../../../shared/feedbackText";
import { readEqualizer, type EqualizerSettings } from "./equalizerSettings";

const emptyLyrics: Line[] = [];

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
    const percent = Math.round(value);
    const current = readPlaybackSettings();
    if (current.vol === percent) return;
    const next = { ...current, vol: percent };
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

const radioVersionLabel = /\b(?:remix(?:ed)?|remaster(?:ed)?|live|acoustic|unplugged|instrumental|karaoke|cover|slowed|sped[ -]?up|speed[ -]?up|nightcore|reverb|extended|radio edit|alternate take|demo|version|official (?:music )?(?:video|audio)|lyric(?:s| video)?)\b/i;

function radioText(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/(\p{Script=Latin})\p{M}+/gu, "$1").replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

function radioSongKey(track: Track): string {
  const title = track.title
    .replace(/\([^()]*\)|\[[^\[\]]*\]/g, (label) => radioVersionLabel.test(label) || /^[(\[]\s*(?:feat\.?|ft\.?)\s/i.test(label) ? " " : label)
    .replace(/\s+[-??|]\s+(.+)$/, (suffix, label: string) => radioVersionLabel.test(label) ? "" : suffix)
    .replace(/\s+(?:slowed(?:\s*(?:\+|and|&)\s*reverb)?|sped[ -]?up|nightcore|(?:\d{4}\s+)?remaster(?:ed)?|radio edit)$/i, "");
  const artist = radioText(track.artist.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, ""));
  const name = radioText(title);
  return artist && name ? name + "\u0000" + artist : "";
}

function radioTracks(items: Track[], excluded: Iterable<Track>): Track[] {
  const ids = new Set<string>();
  const songs = new Set<string>();
  for (const item of excluded) {
    ids.add(item.id);
    const key = radioSongKey(item);
    if (key) songs.add(key);
  }
  return items.filter((item) => {
    const key = radioSongKey(item);
    if (!item.id || ids.has(item.id) || (key && songs.has(key))) return false;
    ids.add(item.id);
    if (key) songs.add(key);
    return true;
  });
}

type RadioSession = {
  seed: string;
  playlist: string;
  continuation: string;
  exhausted: boolean;
  pending?: Promise<void>;
};

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
  const radioSequence = useRef(false);
  const radioSession = useRef<RadioSession | null>(null);
  const radioBuffer = useRef<Track[]>([]);
  const radioSeen = useRef(new Map<string, Track>());
  const [radioPreview, setRadioPreview] = useState<Track[]>([]);
  const collectionSequence = useRef(false);
  const collectionTracks = useRef<Track[]>([]);
  const [playing, setPlaying] = useState(false);
  const [trackLoading, setTrackLoading] = useState(false);
  const trackLoadFailed = useRef(false);
  const [buffering, setBuffering] = useState(false);
  const bufferStall = useRef<{ position: number; since: number } | null>(null);
  const [position, setPosition] = useState(0);
  const positionRef = useRef(position);
  positionRef.current = position;
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => { const value = readPlaybackSettings().vol; return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : 100; });
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
  const playbackListRef = useRef<Track[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const nextPending = useRef<number | null>(null);
  const playbackControlPending = useRef(false);
  const playbackControlVersion = useRef(0);
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;
  const [error, setError] = useState("");
  const [lyricsResult, setLyricsResult] = useState<{ key: string; record: LyricsRecord | null } | null>(null);
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

  const preserveForYouRef = useRef(preserveForYou);
  const togglePreserveForYou = () => {
    const next = !preserveForYou;
    preserveForYouRef.current = next;
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

  const play = useCallback((item: Track, list: Track[] = [item], options?: { fromHistory?: boolean; radio?: boolean; collection?: boolean; continueCollection?: boolean }) => {
    const current = trackRef.current;
    if (!options?.fromHistory && !options?.continueCollection && !options?.radio && !preserveForYouRef.current) {
      radioSession.current = null;
      radioBuffer.current = [];
      setRadioPreview([]);
    }
    radioSeen.current.set(item.id, item);
    const playList = (options?.collection || options?.continueCollection) && list.length ? list : [item];
    const index = Math.max(0, playList.findIndex((entry) => entry.id === item.id));
    if (!options?.fromHistory) radioSequence.current = options?.radio === true;
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
    setPlaybackState(null);
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
        const preparation = Playback.prepareTrack(cached, position).then(async () => {
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
    trackLoadFailed.current = false;
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
        return Playback.playTrack(track);
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
          trackLoadFailed.current = true;
          setPlaying(false);
          setError(error instanceof Error ? feedbackText(error.message) : "couldn't play this song");
        }
      })
      .finally(() => {
        if (active) setTrackLoading(false);
      });

    return () => {
      active = false;
    };
  }, [track]);
  const lyricsTrackID = track?.id;
  const lyricsTitle = track?.title || "";
  const lyricsArtist = track?.artist || "";
  const lyricsAlbum = track?.album || "";
  const catalogDuration = track?.duration_seconds || parseDuration(track?.duration);
  const audioDuration = playbackState?.track_id === lyricsTrackID ? playbackState?.duration || 0 : 0;
  const lyricsDuration = Math.round(audioDuration > 0 && (!catalogDuration || Math.abs(audioDuration - catalogDuration) > Math.max(3, catalogDuration * 0.02)) ? audioDuration : catalogDuration);
  const lyricsKey = JSON.stringify([lyricsTrackID, lyricsTitle, lyricsArtist, lyricsAlbum, lyricsDuration]);
  const lyricsCredit = lyricsResult?.key === lyricsKey ? lyricsResult.record : null;
  const lyrics = lyricsCredit?.lines || emptyLyrics;
  const plainLyrics = lyricsCredit?.plain_lyrics || "";
  const lyricsLoading = Boolean(lyricsTrackID && lyricsResult?.key !== lyricsKey);
  const lyricsPlaying = Boolean(playing && !trackLoading && !buffering && !seekPending.current &&
    playbackState?.track_id === lyricsTrackID && playbackState?.playing);

  useEffect(() => {
    if (!lyricsTrackID) return;
    let active = true;
    void Music.lyrics(lyricsTitle, lyricsArtist, lyricsAlbum, lyricsDuration, lyricsTrackID).then((record) => {
      if (active) setLyricsResult({ key: lyricsKey, record });
    }).catch(() => { if (active) setLyricsResult({ key: lyricsKey, record: null }); });
    return () => { active = false; };
  }, [lyricsKey, lyricsTrackID, lyricsTitle, lyricsArtist, lyricsAlbum, lyricsDuration]);

  const loadRadioPage = useCallback((seed: string): Promise<void> => {
    const session = radioSession.current ?? { seed, playlist: "", continuation: "", exhausted: false };
    radioSession.current = session;
    if (session.pending) return session.pending;
    if (session.exhausted) return Promise.resolve();

    const requestedToken = session.continuation;
    session.pending = Music.radioQueue(session.seed, session.playlist, requestedToken).then((page) => {
      if (radioSession.current !== session) return;
      session.playlist = page?.queuePlaylistId || session.playlist;
      session.continuation = page?.continuationToken || "";
      session.exhausted = !session.continuation || session.continuation === requestedToken;
      const candidates = (page?.items ?? []).flatMap((item): Track[] => {
        const id = item.videoId || item.id;
        if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id) || !item.title) return [];
        return [{
          id, title: item.title, artist: item.artist || item.artists || "", artist_id: "",
          album: item.album || "", album_id: item.albumId || "",
          duration: item.duration || "", duration_seconds: parseDuration(item.duration),
          album_art_url: item.thumbnail || "", stream_url: "", is_favorite: false, is_explicit: item.isExplicit,
        }];
      });
      const current = trackRef.current;
      const excluded = [...radioSeen.current.values(), ...(current ? [current] : []), ...queueRef.current, ...upNextRef.current];
      radioBuffer.current = radioTracks([...radioBuffer.current, ...candidates], excluded);
      setRadioPreview(radioBuffer.current);
    }).finally(() => { session.pending = undefined; });
    return session.pending;
  }, []);

  const radioNeedsRefill = queue.length + upNext.length + radioPreview.length <= 5;
  useEffect(() => {
    if (!autoplay || repeatMode === "queue") {
      radioSession.current = null;
      radioBuffer.current = [];
      setRadioPreview([]);
      return;
    }
    if (track && radioNeedsRefill) void loadRadioPage(track.id).catch(() => {});
  }, [autoplay, track?.id, radioNeedsRefill, repeatMode, loadRadioPage]);

  const mixTracks = autoplay && repeatMode !== "queue" && track
    ? radioTracks(radioPreview, [...radioSeen.current.values(), track])
    : [];
  const nextRadioID = mixTracks[0]?.id;

  const playRadioTrack = (item: Track, recommendations: Track[]) => {
    const remaining = recommendations.filter((candidate) => candidate.id !== item.id);
    radioBuffer.current = remaining;
    setRadioPreview(remaining);
    play(item, [item], { radio: true });
  };

  const playMixTrack = (item: Track) => {
    if (mixTracks.some((candidate) => candidate.id === item.id)) playRadioTrack(item, mixTracks);
  };

  const playQueued = (index: number) => {
    const items = queueRef.current;
    if (!items[index]) return;
    queueRef.current = items.filter((_, itemIndex) => itemIndex !== index);
    setQueue(queueRef.current);
    play(items[index], [items[index], ...upNextRef.current.filter((item) => item.id !== items[index].id)], { radio: radioSequence.current, collection: collectionSequence.current, continueCollection: true });
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
      if (mode === "queue" && track && !collectionSequence.current && !radioSequence.current) {
        const items = queueRef.current;
        queueRef.current = [...items.slice(1), track];
        setQueue(queueRef.current);
        play(items[0], [items[0], ...upNextRef.current], { collection: collectionSequence.current, radio: radioSequence.current, continueCollection: true });
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
    if (upNextRef.current.length && (!radioSequence.current || autoplay)) {
      play(upNextRef.current[0], upNextRef.current, { radio: radioSequence.current, continueCollection: true });
      return;
    }
    if (mode === "queue" && track && (!radioSequence.current || autoplay)) {
      const list = playbackListRef.current.length ? playbackListRef.current : [track];
      play(list[0], list, { radio: radioSequence.current, continueCollection: true });
      return;
    }
    if (!autoplay || !track || mode === "queue") return;
    const playRadio = (candidates: Track[]) => {
      const recommendations = radioTracks(candidates, [...radioSeen.current.values(), track]);
      const first = recommendations[0];
      if (!first) return false;
      playRadioTrack(first, recommendations);
      return true;
    };
    if (playRadio(radioBuffer.current)) return;
    if (nextPending.current === playbackVersion.current) return;
    nextPending.current = version;
    try {
      for (let page = 0; page < 3; page++) {
        await loadRadioPage(track.id);
        if (version !== playbackVersion.current || controlVersion !== playbackControlVersion.current || playbackControlPending.current || !autoplayRef.current) return;
        if (queueRef.current.length) { playQueued(0); return; }
        if (repeatModeRef.current === "queue") {
          const collection = collectionSequence.current;
          const list = (collection ? collectionTracks.current : playbackListRef.current);
          if (list.length && !radioSequence.current) play(list[0], list, { collection, continueCollection: true });
          return;
        }
        if (playRadio(radioBuffer.current)) return;
        if (radioSession.current?.exhausted) break;
      }
      setError("couldn't load more songs");
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
    if (!collectionSequence.current || upNextRef.current.length < 2) return;
    const result = [...upNextRef.current];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    const upcomingIDs = new Set(result.map((item) => item.id));
    collectionTracks.current = [...collectionTracks.current.filter((item) => !upcomingIDs.has(item.id)), ...result];
    upNextRef.current = result;
    setUpNext(result);
    if (trackRef.current && readPlaybackSettings().resume !== false) {
      try { localStorage.setItem(collectionStateKey, JSON.stringify({ trackID: trackRef.current.id, tracks: collectionTracks.current, next: result })); } catch {}
    }
  };
  const toggle = async () => {
    if (!track || playbackControlPending.current) return;
    if (trackLoading && !pendingRestore.current) return;
    if (!playing && trackLoadFailed.current) {
      trackLoadFailed.current = false;
      setTrackLoading(true);
      setError("");
      setTrack({ ...track });
      return;
    }
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
            await Playback.prepareTrack(track, restored.position);
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
        await Playback.playTrack(currentTrack);
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
    setSeekVersion(++seekVersionRef.current);
    seekPending.current = false;
    void Playback.stop().catch(() => {});
    setPlaying(false);
    setPosition(0);
    setPlaybackState((current) => current ? { ...current, playing: false, position: 0, buffer_ahead: 0 } : null);
  };


  useEffect(() => {
    if (!track || trackLoading) return;
    let active = true;
    let pending = false;
    let wakePending = false;
    let handledEndVersion = -1;
    const playVersion = playbackVersion.current;
    const sample = (countListening: boolean) => {
      const version = seekVersionRef.current;
      const controlVersion = playbackControlVersion.current;
      if (!active || seekPending.current || playbackVersion.current !== playVersion) return;
      if (pending) {
        if (!countListening) wakePending = true;
        return;
      }
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
        if (countListening && playing && state.playing) {
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

        if (playing && !state.playing && (state.error || state.ended) && handledEndVersion !== version) {
          handledEndVersion = version;
          setPlaying(false);
          if (state.error) setError(feedbackText(state.error));
          else {
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
      }).catch(() => { if (active) setError("couldn't check playback"); }).finally(() => {
        pending = false;
        if (wakePending) {
          wakePending = false;
          sample(false);
        }
      });
    };
    const unsubscribe = events.playbackEnded.on((id) => { if (id === track.id) sample(false); });
    const timer = window.setInterval(() => sample(true), 250);
    sample(false);
    return () => { active = false; window.clearInterval(timer); unsubscribe(); };
  }, [track, playing, trackLoading, repeat, repeatMode, queue, upNext, autoplay, forYou, popular, playbackSettings.hist, privateListening]);
  useEffect(() => {
    void TrayControl.update({ hasTrack: Boolean(track), playing, hasNext: Boolean(track && (queue.length || upNext.length || forwardStackRef.current.length || repeatMode === "queue" || autoplay)), muted }).catch(() => setError("tray controls aren't working right now"));
  }, [track, playing, queue.length, upNext.length, repeatMode, autoplay, muted]);

  useEffect(() => {
    const queued = queue[0] || ((!radioSequence.current || autoplay) ? upNext[0] : undefined);
    const repeatTrack = repeatMode === "queue" && (!radioSequence.current || autoplay)
      ? (collectionSequence.current ? collectionTracks.current[0] : playbackListRef.current[0])
      : undefined;
    const nextTrack = playing && !trackLoading
      ? forwardStackRef.current.at(-1) || queued || repeatTrack || mixTracks[0]
      : undefined;
    const prefetch = nextTrack ? Playback.prefetchTrack(nextTrack) : Playback.prefetch("");
    void prefetch.catch(() => setError("couldn't get the next song ready"));
  }, [playing, trackLoading, track?.id, queue[0]?.id, upNext, autoplay, nextRadioID, repeatMode]);

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
      const trackVersion = playbackVersion.current;
      const seekVersion = seekVersionRef.current;
      const controlVersion = playbackControlVersion.current;
      void Playback.state().then((state) => {
        if (trackVersion !== playbackVersion.current || seekVersion !== seekVersionRef.current ||
            controlVersion !== playbackControlVersion.current || seekPending.current || !state.track_id ||
            state.track_id !== trackRef.current?.id || !Number.isFinite(state.position) || state.position < 0) return;
        setSeekVersion(++seekVersionRef.current);
        setPosition(state.position);
      }).catch(() => {});
    }
  }), []);
  return { seek, seekVersion, changeVolume, track, trackLoading, buffering, history, clearHistory, popular, forYou, preserveForYou, togglePreserveForYou, queue, upNext, mixTracks, playMixTrack, playing, position, duration, volume, muted, repeat, repeatMode, cycleRepeat, autoplay, error, lyrics, plainLyrics, lyricsCredit, lyricsLoading, lyricsPlaying, playbackState, discordEnabled, toggleDiscord, privateListening, togglePrivateListening, resetAudioEngine, stopPlayback, play, playQueued, previous, next, shuffle, toggle, toggleMute, setQueue, setError, setPlaying, setPosition, setDuration, setVolume, setRepeat, setAutoplay };
}
