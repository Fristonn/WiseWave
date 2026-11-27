import { useEffect, useRef, useState } from "react";
import { Music, type Track } from "../../../mygo";
import { useSnackbar } from "../../../shared/ui/Snackbar";
import { formatDurationSeconds, trackDurationSeconds, withTrackDuration } from "../shared/trackDuration";

export type LibraryTrack = Track & { addedAt?: string };
export type Playlist = { id: string; name: string; description: string; cover?: string; tracks: LibraryTrack[] };
export type LibraryAddNotice = { text: "added to"; title: string; artwork: string; textSuffix: string };
type Data = { liked: LibraryTrack[]; playlists: Playlist[] };
const key = "wisewave-library";

function addedNotice(title: string, artwork: string, destination: string): LibraryAddNotice {
  return { text: "added to", title, artwork, textSuffix: destination };
}

function durationSeconds(track: Track): number {
  return trackDurationSeconds(track);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function matchingDuration(track: Track, results: Track[]): Track | undefined {
  const title = normalize(track.title);
  const artist = normalize(track.artist);
  if (!title || !artist) return results.find((result) => result.id === track.id && durationSeconds(result) > 0);
  return results.find((result) => result.id === track.id && durationSeconds(result) > 0)
    || results.find((result) => {
      const resultArtist = normalize(result.artist);
      return normalize(result.title) === title && durationSeconds(result) > 0 && resultArtist
        && (resultArtist.includes(artist) || artist.includes(resultArtist));
    });
}

function parseAddedAt(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function trackAddedAt(track: LibraryTrack & { added_at?: string }): string {
  return parseAddedAt(track.addedAt) || parseAddedAt(track.added_at);
}

export function formatAddedAt(value?: string): string {
  const iso = parseAddedAt(value);
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function withLibraryMeta(track: Track | LibraryTrack, addedAt?: string): LibraryTrack {
  const existing = track as LibraryTrack & { added_at?: string };
  const stamp = parseAddedAt(addedAt) || trackAddedAt(existing) || new Date().toISOString();
  const { added_at: _legacy, ...rest } = existing;
  return { ...rest, addedAt: stamp };
}

function normalizeData(data: Data): { data: Data; changed: boolean } {
  let changed = false;
  const fixTrack = (track: LibraryTrack) => {
    const next = withLibraryMeta(track);
    if (next.addedAt !== track.addedAt || (track as { added_at?: string }).added_at) changed = true;
    return next;
  };
  const liked = (Array.isArray(data.liked) ? data.liked : []).map(fixTrack);
  const playlists = (Array.isArray(data.playlists) ? data.playlists : []).map((playlist) => ({
    ...playlist,
    tracks: (Array.isArray(playlist.tracks) ? playlist.tracks : []).map(fixTrack),
  }));
  return { data: { liked, playlists }, changed };
}

function read(onError?: (message: string) => void): Data {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "{}");
    const { data, changed } = normalizeData({
      liked: Array.isArray(raw.liked) ? raw.liked : [],
      playlists: Array.isArray(raw.playlists) ? raw.playlists : [],
    });
    if (changed) {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        onError?.("couldn't update your saved song details");
      }
    }
    return data;
  } catch {
    return { liked: [], playlists: [] };
  }
}

export function useLibrary() {
  const loadError = useRef("");
  const [data, setData] = useState(() => read((message) => { loadError.current = message; }));
  const currentData = useRef(data);
  const [error, setError] = useState(loadError.current);
  const notify = useSnackbar();
  const durationSyncRequested = useRef(new Set<string>());
  const update = (change: (current: Data) => Data) => {
    const next = change(currentData.current);
    if (next === currentData.current) return true;
    try {
      localStorage.setItem(key, JSON.stringify(next));
      currentData.current = next;
      setData(next);
      setError("");
      return true;
    } catch {
      setError("couldn't save your library changes");
      return false;
    }
  };
  useEffect(() => {
    const tracks = [...new Map([...data.liked, ...data.playlists.flatMap((playlist) => playlist.tracks)]
      .filter((track) => !durationSeconds(track) && !durationSyncRequested.current.has(track.id))
      .map((track) => [track.id, track])).values()];
    tracks.forEach((track) => durationSyncRequested.current.add(track.id));
    let next = 0;
    const sync = async () => {
      while (next < tracks.length) {
        const track = tracks[next++];
        try {
          const match = matchingDuration(track, await Music.search(`${track.title} ${track.artist}`));
          const seconds = match ? durationSeconds(match) : 0;
          if (!seconds) {
            durationSyncRequested.current.delete(track.id);
            continue;
          }
          const duration = match!.duration || formatDurationSeconds(seconds);
          update((current) => {
            const withDuration = (item: LibraryTrack) => item.id === track.id && !durationSeconds(item)
              ? withLibraryMeta({ ...item, duration, duration_seconds: seconds }, item.addedAt)
              : item;
            return {
              liked: current.liked.map(withDuration),
              playlists: current.playlists.map((playlist) => ({ ...playlist, tracks: playlist.tracks.map(withDuration) })),
            };
          });
        } catch {
          durationSyncRequested.current.delete(track.id);
          continue;
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(2, tracks.length) }, sync));
  }, [data.liked, data.playlists]);
  const toggleLike = (track: Track, onAdded: (notice: LibraryAddNotice) => void = notify) => {
    const alreadyLiked = currentData.current.liked.some((item) => item.id === track.id);
    const saved = update((current) => ({
      ...current,
      liked: alreadyLiked ? current.liked.filter((item) => item.id !== track.id) : [withLibraryMeta(track), ...current.liked],
    }));
    if (saved && !alreadyLiked) onAdded(addedNotice(track.title, track.album_art_url, "Liked Songs"));
  };
  const create = (name: string, description: string, cover?: string, track?: Track) => {
    const playlist: Playlist = { id: crypto.randomUUID(), name, description, cover, tracks: track ? [withLibraryMeta(track)] : [] };
    if (update((current) => ({ ...current, playlists: [playlist, ...current.playlists] })) && track) {
      notify(addedNotice(track.title, track.album_art_url, name));
    }
    return playlist;
  };
  const add = (id: string, track: Track) => {
    const playlist = currentData.current.playlists.find((item) => item.id === id);
    if (!playlist || playlist.tracks.some((item) => item.id === track.id)) return;
    const saved = update((current) => ({
      ...current,
      playlists: current.playlists.map((item) => item === playlist ? { ...item, tracks: [...item.tracks, withLibraryMeta(track)] } : item),
    }));
    if (saved) notify(addedNotice(track.title, track.album_art_url, playlist.name));
  };
  const remove = (id: string, track: Track) => update((current) => ({
    ...current,
    playlists: current.playlists.map((playlist) => playlist.id === id
      ? { ...playlist, tracks: playlist.tracks.filter((item) => item.id !== track.id) }
      : playlist),
  }));
  const edit = (id: string, name: string, description: string, cover?: string) => update((current) => ({
    ...current,
    playlists: current.playlists.map((playlist) => playlist.id === id ? { ...playlist, name, description, cover } : playlist),
  }));
  const removePlaylist = (id: string) => update((current) => ({
    ...current,
    playlists: current.playlists.filter((playlist) => playlist.id !== id),
  }));
  const ensureDuration = (id: string, seconds: number) => {
    const total = Math.max(0, Math.floor(seconds));
    if (!id || !total) return;
    update((current) => {
      let changed = false;
      const apply = (item: LibraryTrack) => {
        if (item.id !== id || durationSeconds(item) > 0) return item;
        changed = true;
        return withLibraryMeta(withTrackDuration(item, total), item.addedAt);
      };
      const liked = current.liked.map(apply);
      const playlists = current.playlists.map((playlist) => ({ ...playlist, tracks: playlist.tracks.map(apply) }));
      return changed ? { liked, playlists } : current;
    });
  };
  const importCollection = (payload: { provider?: "spotify" | "youtube"; liked: boolean; sourceId: string; title: string; cover?: string; tracks: Track[] }) => {
    const incoming = (Array.isArray(payload.tracks) ? payload.tracks : [])
      .filter((track) => track?.id)
      .map((track) => withLibraryMeta(track));
    const current = read(setError);
    const provider = payload.provider || "spotify";
    const id = `${provider}:${payload.sourceId}`;
    const existing = current.playlists.find((playlist) => playlist.id === id);
    const destination = payload.liked ? "Liked Songs" : payload.title || existing?.name || "Imported playlist";
    const seen = new Set((payload.liked ? current.liked : existing?.tracks ?? []).map((track) => track.id));
    const added = incoming.filter((track) => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
    const next = (() => {
      if (payload.liked) {
        const updates = new Map(incoming.map((track) => [track.id, track]));
        const existing = current.liked.map((track) => {
          const refreshed = updates.get(track.id);
          return refreshed ? withLibraryMeta({ ...track, ...refreshed }, track.addedAt) : track;
        });
        return { ...current, liked: [...added, ...existing] };
      }
      const playlist: Playlist = {
        id,
        name: destination,
        description: existing?.description || `Imported from ${provider === "youtube" ? "YouTube Music" : "Spotify"}`,
        cover: payload.cover || existing?.cover,
        tracks: incoming,
      };
      return {
        ...current,
        playlists: existing
          ? current.playlists.map((item) => (item.id === id ? playlist : item))
          : [playlist, ...current.playlists],
      };
    })();
    if (!update(() => next)) throw new Error("couldn't save your library changes");
    if (!added.length) return;
    const title = added.length === 1 ? added[0].title : `${added.length} songs`;
    return addedNotice(title, added.find((track) => track.album_art_url)?.album_art_url || "", destination);
  };
  return { ...data, error, clearError: () => setError(""), toggleLike, create, add, remove, edit, removePlaylist, ensureDuration, importCollection };
}
