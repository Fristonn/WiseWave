import { useCallback, useEffect, useRef, useState } from "react";
import { isMyGo } from "mygo-runtime";
import { Music, events, type OfflineTrack, type Track } from "../../../mygo";
import { trackDurationSeconds } from "../shared/trackDuration";
import { useSnackbar } from "../../../shared/ui/Snackbar";

export type DownloadJob = { track: Track; status: "queued" | "downloading" | "failed"; error?: string; progress?: number };
export type DownloadState = "saved" | DownloadJob["status"] | undefined;

export function downloadedTrack(item: OfflineTrack): Track {
  return {
    id: item.id, title: item.title, artist: item.artist, album: item.album,
    artist_id: "", album_id: "", album_art_url: item.album_art_url || "",
    duration: item.duration || "", duration_seconds: item.duration_seconds || 0,
    stream_url: "", is_favorite: false, is_explicit: item.is_explicit,
  };
}

export function useDownloads() {
  const show = useSnackbar();
  const [saved, setSaved] = useState<OfflineTrack[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const savedIDs = useRef(new Set<string>());
  const pendingIDs = useRef(new Set<string>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const tracks = await Music.listDownloads();
    if (version !== refreshVersion.current) return;
    savedIDs.current = new Set((tracks || []).map((track) => track.id));
    setSaved(tracks || []);
    setError("");
  }, []);
  const reload = useCallback(() => {
    setLoading(true);
    void refresh().catch(() => setError("couldn't load your downloads. try again")).finally(() => setLoading(false));
  }, [refresh]);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (!isMyGo()) return;
    return events.downloadProgressChanged.on(({ track_id, received, total }) => {
      const progress = total > 0 ? Math.max(0, Math.min(1, received / total)) : undefined;
      setJobs((items) => items.map((item) => item.track.id === track_id && item.status === "downloading" ? { ...item, progress } : item));
    });
  }, []);
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) reload(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  const download = useCallback((track: Track) => {
    if (savedIDs.current.has(track.id) || pendingIDs.current.has(track.id)) return;
    pendingIDs.current.add(track.id);
    const source = { ...track, duration_seconds: trackDurationSeconds(track) };
    setJobs((items) => [...items.filter((item) => item.track.id !== track.id), { track: source, status: "queued" }]);
    chain.current = chain.current.then(async () => {
      setJobs((items) => items.map((item) => item.track.id === track.id ? { ...item, status: "downloading", error: undefined } : item));
      try {
        await Music.download(source);
        await refresh();
        setJobs((items) => items.filter((item) => item.track.id !== track.id));
      } catch {
        setJobs((items) => items.map((item) => item.track.id === track.id ? { ...item, status: "failed", error: "couldn't download this song. try again" } : item));
        show({ text: "couldn't download this song. try again" });
      } finally {
        pendingIDs.current.delete(track.id);
      }
    });
  }, [refresh, show]);

  const state = useCallback((id: string): DownloadState => {
    if (saved.some((track) => track.id === id)) return "saved";
    return jobs.find((job) => job.track.id === id)?.status;
  }, [saved, jobs]);
  const remove = useCallback(async (track: Track) => {
    if (pendingIDs.current.has(track.id)) return false;
    pendingIDs.current.add(track.id);
    try {
      await Music.deleteDownload(track.id);
      refreshVersion.current++;
      savedIDs.current.delete(track.id);
      setSaved((items) => items.filter((item) => item.id !== track.id));
      setError("");
      show({ text: "download deleted" });
      return true;
    } catch {
      setError("couldn't delete this download. try again");
      void refresh().catch(() => {});
      return false;
    } finally {
      pendingIDs.current.delete(track.id);
    }
  }, [refresh, show]);
  return { saved, jobs, loading, error, clearError: () => setError(""), download, reload, state, remove };
}
