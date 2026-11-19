import { CatalogCollection } from "../catalog/CatalogCollection";
import { ExplicitBadge } from "../shared/ExplicitBadge";
import { useState, useMemo, useEffect, type ReactNode } from "react";
import { Clock3, Heart, ListMusic, Search } from "lucide-react";
import type { Track } from "../../../mygo";
import { formatAddedAt, type LibraryTrack, type Playlist } from "./useLibrary";
import { ArtistLinks } from "../shared/ArtistLinks";
import { Artwork, artworkURL } from "../../../shared/ui/Artwork";
import { PlayingSpectrum } from "../../../shared/ui/PlayingSpectrum";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { PlayIcon } from "../../../shared/ui/icons";
import { DEFAULT_PLAYLIST_THEME, useImageTheme } from "../shared/artworkColor";
import { trackDurationLabel, trackDurationSeconds } from "../shared/trackDuration";
import { LikedSongsCover } from "./LikedSongsCover";
import { usePlaylistMenu } from "./PlaylistMenu";
import { useSongMenu } from "../shared/SongMenu";
import { DownloadsCover } from "../downloads/DownloadsCover";

export function Collection({
  kind,
  playlist,
  tracks,
  onPlay,
  onArtist,
  onAlbum,
  onBack,
  current = null,
  playing = false,
  children,
  emptyState,
}: {
  onBack?: () => void;
  kind: "liked" | "playlist" | "downloads";
  playlist?: Playlist;
  tracks: LibraryTrack[];
  onPlay: (track: Track, tracks: Track[], options?: { collection?: boolean }) => void;
  onArtist: (track: Track) => void;
  onAlbum?: (id: string) => void;
  current?: Track | null;
  playing?: boolean;
  children?: ReactNode;
  emptyState?: ReactNode;
}) {
  const openSongMenu = useSongMenu();
  const openPlaylistMenu = usePlaylistMenu();
  const [query, setQuery] = useState("");
  const [coverFailed, setCoverFailed] = useState(false);
  const [fallbackCoverFailed, setFallbackCoverFailed] = useState(false);

  useEffect(() => {
    setCoverFailed(false);
    setFallbackCoverFailed(false);
  }, [playlist?.cover, playlist?.id]);

  const visibleSongs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((song) =>
      `${song.title} ${song.artist} ${song.album || ""}`.toLowerCase().includes(q)
    );
  }, [tracks, query]);

  const totalMinutes = useMemo(() => {
    const totalSeconds = tracks.reduce((sum, song) => sum + trackDurationSeconds(song), 0);
    return Math.max(0, Math.floor(totalSeconds / 60));
  }, [tracks]);
  const statsLabel = `${tracks.length} ${tracks.length === 1 ? "song" : "songs"} of ${totalMinutes} ${totalMinutes === 1 ? "minute" : "minutes"}`;

  const name =
    kind === "liked"
      ? "Liked Songs"
      : kind === "downloads" ? "Downloads" : playlist?.name || "Playlist";

  const searchPlaceholder =
    kind === "liked"
      ? "Search in Your Library"
      : kind === "downloads" ? "Search in downloads" : "Search in playlist";

  const playlistArtwork = useMemo(() => {
    if (kind !== "playlist") return "";
    const firstArt = tracks[0]?.album_art_url || "";
    const source = playlist?.cover && !coverFailed ? playlist.cover : firstArt;
    return artworkURL(source, 256) || source;
  }, [kind, playlist?.cover, tracks, coverFailed]);
  const playlistTheme = useImageTheme(playlistArtwork || null, DEFAULT_PLAYLIST_THEME);

  if (kind === "playlist" && playlist) return <CatalogCollection kind="playlist" id={playlist.id} localData={{ id: playlist.id, title: playlist.name, description: playlist.description, artwork_url: playlist.cover || "", author: "", tracks }} onBack={onBack || (() => {})} onPlay={(track, queue) => onPlay(track, queue, { collection: true })} onArtist={onArtist} current={current} playing={playing} onCollectionMenu={(event) => openPlaylistMenu(event, playlist)} />;

  return (
    <section className={`view-enter collection collection-${kind}`}>
      <div className="collection-header" style={kind === "playlist" ? { background: playlistTheme.gradient } : undefined} onContextMenu={(event) => { if (playlist) openPlaylistMenu(event, playlist); }}>
        <div className="collection-heading">
          {kind === "liked" ? (
            <LikedSongsCover className="collection-cover" />
          ) : kind === "downloads" ? (
            <DownloadsCover className="collection-cover" />
          ) : playlistArtwork && !(coverFailed && fallbackCoverFailed) ? (
            <Artwork
              className="collection-cover playlist-custom-cover"
              src={playlistArtwork}
              size={256}
              onFail={() => {
                if (playlist?.cover && !coverFailed) setCoverFailed(true);
                else setFallbackCoverFailed(true);
              }}
            />
          ) : (
            <div className="collection-cover playlist-cover-fallback">
              <ListMusic size={52} />
            </div>
          )}
          <div className="collection-heading-meta">
            <p className="collection-header-category">{kind === "downloads" ? "Your Library" : "Playlist"}</p>
            <h1 className="collection-header-title"><MarqueeText>{name}</MarqueeText></h1>
            {playlist?.description && (
              <p className="collection-header-desc"><MarqueeText>{playlist.description}</MarqueeText></p>
            )}
            <p className="collection-header-stats">
              <MarqueeText>{statsLabel}</MarqueeText>
            </p>
          </div>
        </div>
      </div>

      <div className="collection-content">
        <div className="collection-toolbar">
          <button
            aria-label={`Play ${name}`}
            className="collection-play-btn"
            disabled={!tracks.length}
            type="button"
            onClick={() => visibleSongs.length && onPlay(visibleSongs[0], visibleSongs, { collection: kind === "liked" })}
          >
            <PlayIcon className="play-icon-glyph" />
          </button>

          <label className="collection-search-label">
            <Search className="search-icon" size={16} />
            <input
              aria-label={searchPlaceholder}
              className="player-search-input"
              placeholder={searchPlaceholder}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        {kind !== "downloads" && children}

        <div className="collection-table-header collection-library-table-header">
          <span className="col-num-header">#</span>
          <span className="collection-grid-cols collection-library-grid-cols">
            <span className="col-title-header">Title</span>
            <span className="collection-meta-header">{kind !== "playlist" ? "Author" : "Album"}</span>
            <span className="col-date-header">{kind === "downloads" ? "downloaded" : "Date added"}</span>
            <Clock3 className="col-duration-icon" size={16} />
          </span>
        </div>

        <div className="collection-songs-list">
          {kind === "downloads" && children}
          {visibleSongs.map((song, index) => (
            <div
              aria-label={`Play ${song.title} by ${song.artist}`}
              className="collection-song-row group"
              key={song.id}
              role="button"
              tabIndex={0}
              onContextMenu={(event) => openSongMenu(event, song, kind === "playlist" && playlist ? { kind: "playlist", id: playlist.id } : kind === "liked" ? { kind: "liked" } : { kind: "downloads" })}
              onClick={() => onPlay(song, visibleSongs, { collection: kind === "liked" })}
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onPlay(song, visibleSongs, { collection: kind === "liked" }); } }}
            >
              <span className="song-index-num">{index + 1}</span>

              <span className="collection-grid-cols collection-library-grid-cols">
                <span className="song-title-cell">
                  <span className="song-artwork-container">
                    <Artwork
                      className="song-artwork-img"
                      src={song.album_art_url}
                      size={40}
                      lazy={index >= 12}
                    />
                    <PlayingSpectrum active={current?.id === song.id} playing={playing} size={24} />
                    <span className="song-play-hover-overlay">
                      <PlayIcon className="play-hover-glyph" />
                    </span>
                  </span>
                  <span className="song-title-wrapper">
                    <span className="song-menu-title" onContextMenu={kind === "playlist" ? (event) => openSongMenu(event, song, playlist ? { kind: "playlist", id: playlist.id } : undefined) : undefined}><MarqueeText className="song-main-title">{song.title}</MarqueeText></span>
                    <small className="song-sub-label">
                      {kind === "liked" ? <>Liked song<span className="song-compact-artist"> · <ArtistLinks track={song} onOpen={onArtist} /></span></> : <ArtistLinks track={song} onOpen={onArtist} />}
                    </small>
                  </span>
                </span>

                <span className="collection-meta-cell">
                  {kind !== "playlist" ? (
                    <MarqueeText className="collection-meta-marquee song-author-marquee">
                      <ArtistLinks track={song} onOpen={onArtist} />
                    </MarqueeText>
                  ) : (
                    <MarqueeText className="collection-meta-marquee">
                      {song.album && song.album_id && onAlbum ? <span className="artist-links"><button type="button" onClick={(event) => { event.stopPropagation(); onAlbum(song.album_id); }}>{song.album}</button></span> : song.album || "—"}
                    </MarqueeText>
                  )}
                </span>

                <span className="song-date-cell">
                  {formatAddedAt(song.addedAt) || "—"}
                </span>

                <span className="song-duration-cell">
                  <ExplicitBadge explicit={song.is_explicit} /><span className="duration-digits">{trackDurationLabel(song)}</span>
                </span>
              </span>
            </div>
          ))}
        </div>

        {!visibleSongs.length &&
          (query ? (
            <p className="collection-empty-msg">
              no songs in {name} match your search
            </p>
          ) : emptyState ? emptyState : kind === "liked" ? (
            <div className="collection-empty-box">
              <Heart className="empty-icon" size={36} />
              <strong className="empty-title">no liked songs yet</strong>
              <p className="empty-subtitle">songs you like will show up here</p>
            </div>
          ) : (
            <div className="collection-empty-box">
              <ListMusic className="empty-icon" size={36} />
              <strong className="empty-title">this playlist is empty</strong>
              <p className="empty-subtitle">songs you add will show up here</p>
            </div>
          ))}
      </div>
    </section>
  );
}
