import { useEffect, useMemo } from "react";
import { Download, LoaderCircle } from "lucide-react";
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

  return <Collection kind="downloads" tracks={tracks} onPlay={onPlay} onArtist={onArtist} current={current} playing={playing} emptyState={error || jobs.length ? <></> : emptyState}>
    {jobs.map((job) => <div key={job.track.id} className={`collection-song-row downloads-job${job.status === "downloading" ? " is-downloading" : ""}`}>
      <span className="song-index-num" aria-hidden="true">–</span>
      <span className="collection-grid-cols collection-library-grid-cols">
        <span className="song-title-cell">
          <span className="song-artwork-container"><Artwork className="song-artwork-img" src={job.track.album_art_url} size={40} /></span>
          <span className="downloads-job-copy">
            <MarqueeText className="song-main-title">{job.track.title}</MarqueeText>
            {job.status === "downloading" ? <span className="downloads-progress-line"><span className="downloads-progress" role="progressbar" aria-label={`downloading ${job.track.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress === undefined ? undefined : Math.round(job.progress * 100)}><span className={job.progress === undefined ? "indeterminate" : ""} style={job.progress === undefined ? undefined : { width: `${job.progress * 100}%` }} /></span><span className="downloads-progress-percent">{job.progress === undefined ? "—" : `${Math.round(job.progress * 100)}%`}</span></span> : <span className="song-sub-label">{job.status === "queued" ? "waiting to download" : "download failed"}</span>}
          </span>
        </span>
        <span className="collection-meta-cell">{job.track.artist}</span>
        <span className="col-date-header" />
        {job.status === "failed" ? <button className="downloads-retry" type="button" onClick={() => onRetry(job.track)}>retry</button> : <span />}
      </span>
    </div>)}
  </Collection>;
}
