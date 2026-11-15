import { useCallback, useEffect, useRef, useState } from "react";
import { Music, type OfflineTrack, type Track } from "../../../mygo";
import { trackDurationSeconds } from "../shared/trackDuration";

export type DownloadJob = { track: Track; status: "queued" | "downloading" | "failed"; error?: string };
export type DownloadState = "saved" | DownloadJob["status"] | undefined;

export function downloadedTrack(item: OfflineTrack): Track {
  return {
    id: item.id, title: item.title, artist: item.artist, album: item.album,
    artist_id: "", album_id: "", album_art_url: item.album_art_url || "",
    duration: item.duration || "", duration_seconds: item.duration_seconds || 0,
    stream_url: "", is_favorite: false,
  };
}

export function useDownloads() {
  const [saved, setSaved] = useState<OfflineTrack[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const savedIDs = useRef(new Set<string>());
  const pendingIDs = useRef(new Set<string>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const refresh = useCallback(async () => {
    const tracks = await Music.listDownloads();
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
      } finally {
        pendingIDs.current.delete(track.id);
      }
    });
  }, [refresh]);

  const state = useCallback((id: string): DownloadState => {
    if (saved.some((track) => track.id === id)) return "saved";
    return jobs.find((job) => job.track.id === id)?.status;
  }, [saved, jobs]);
  return { saved, jobs, loading, error, download, reload, state };
}
