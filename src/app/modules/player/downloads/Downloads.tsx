import { useEffect, useMemo } from "react";
import { ArrowDownToLine, Download, LoaderCircle } from "lucide-react";
import type { OfflineTrack, Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { Collection } from "../library/Collection";
import { downloadedTrack, type DownloadJob } from "./useDownloads";

export function Downloads({ saved, jobs, loading, error, onReload, onRetry, onPlay, onArtist, current, playing }: {
  saved: OfflineTrack[];
  jobs: DownloadJob[];
  loading: boolean;
  error: string;
  onReload: () => void;
  onRetry: (track: Track) => void;
  onPlay: (track: Track, tracks: Track[], options?: { collection?: boolean }) => void;
  onArtist: (track: Track) => void;
  current: Track | null;
  playing: boolean;
}) {
  useEffect(onReload, [onReload]);
  const tracks = useMemo(() => saved.map((item) => ({ ...downloadedTrack(item), addedAt: new Date(item.modified_at).toISOString() })), [saved]);
  const emptyState = <div className="collection-empty-box" role={loading ? "status" : undefined}>
    {loading ? <LoaderCircle className="empty-icon downloads-spinner" size={36} /> : <Download className="empty-icon" size={36} />}
    <strong className="empty-title">{loading ? "loading downloads…" : "no downloaded songs yet"}</strong>
    <p className="empty-subtitle">{loading ? "getting your saved songs" : "right click any song to download it for offline listening"}</p>
  </div>;

  return <Collection kind="downloads" tracks={tracks} onPlay={onPlay} onArtist={onArtist} current={current} playing={playing} emptyState={error ? <></> : emptyState}>
    {jobs.length > 0 && <div className="downloads-jobs" aria-live="polite">
      {jobs.map((job) => <div key={job.track.id} className="downloads-job">
        <Artwork className="song-artwork-img" src={job.track.album_art_url} size={40} />
        <div className="downloads-job-copy">
          <MarqueeText className="song-main-title">{job.track.title}</MarqueeText>
          <span className={`song-sub-label${job.status === "failed" ? " downloads-failure" : ""}`}>{job.status === "downloading" ? "downloading…" : job.status === "queued" ? "waiting to download" : job.error}</span>
        </div>
        {job.status === "failed" ? <button className="downloads-retry" type="button" onClick={() => onRetry(job.track)}>retry</button> : job.status === "downloading" ? <LoaderCircle className="downloads-spinner" size={18} aria-label="Downloading" /> : <ArrowDownToLine size={18} aria-label="Queued" />}
      </div>)}
    </div>}
    {error && <div className="downloads-error" role="alert"><span>{error}</span><button type="button" className="downloads-retry" onClick={onReload}>try again</button></div>}
  </Collection>;
}
