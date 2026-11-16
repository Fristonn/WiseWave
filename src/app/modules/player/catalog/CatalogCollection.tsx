import { ExplicitBadge } from "../shared/ExplicitBadge";
import { useEffect, useState, type MouseEvent } from "react";
import { ArrowLeft, CalendarDays, Clock3, ListMusic, Play, Shuffle, Search, MoreHorizontal } from "lucide-react";
import { Music, type AlbumDetail, type PlaylistDetail, type Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { PlayingSpectrum } from "../../../shared/ui/PlayingSpectrum";
import { Classic } from "../../../shared/ui/Classic";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { ArtistLinks } from "../shared/ArtistLinks";
import { trackDurationLabel } from "../shared/trackDuration";
import { useSongMenu } from "../shared/SongMenu";
import { PlayerAlert } from "../shared/PlayerAlert";

export function CatalogCollection({ kind, id, onBack, onPlay, onArtist, current = null, playing = false, localData, onCollectionMenu, category, searchContext, loading = false, loadError = "", onRetry }: {
  searchContext?: "mix" | "playlist" | "album"; category?: string; loading?: boolean; loadError?: string; onRetry?: () => void;
  localData?: PlaylistDetail; onCollectionMenu?: (event: MouseEvent<HTMLElement>) => void;
  kind: "album" | "playlist"; id: string; onBack: () => void; onPlay: (track: Track, tracks: Track[], options?: { collection?: boolean }) => void; onArtist: (track: Track) => void; current?: Track | null; playing?: boolean;
}) {
  const openSongMenu = useSongMenu();
  const [album, setAlbum] = useState<AlbumDetail | PlaylistDetail | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const searchLabel = `Search ${searchContext || kind}`;
  useEffect(() => setQuery(""), [id]);
  useEffect(() => {
    if (localData) return;
    let active = true;
    setAlbum(null); setError("");
    void (kind === "album" ? Music.album(id) : Music.playlist(id)).then((value) => {
      if (!active) return;
      if (value) setAlbum(value);
      else setError(`couldn't load this ${kind}`);
    }).catch(() => { if (active) setError(`couldn't load this ${kind}`); });
    return () => { active = false; };
  }, [id, kind, retry, localData]);
  const collection = localData || album;
  const tracks = collection?.tracks || [];
  const play = (track: Track, list = tracks) => onPlay(track, list, { collection: true });
  const visibleTracks = query.trim() ? tracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : tracks;
  const shuffle = () => {
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    if (shuffled.length) play(shuffled[0], shuffled);
  };
  if (!collection) return <div className="artist-page artist-page-status">
    <button className="mix-back" type="button" onClick={onBack}><ArrowLeft size={18} /> Back</button>
    {error ? <><PlayerAlert message={error} onDismiss={() => {}} action={{ label: "retry", onClick: () => setRetry((value) => value + 1) }} /><button className="artist-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>try again</button></> : <p className="feed-message loading-state" role="status"><Classic />loading {kind}...</p>}
  </div>;
  return <div className={`album-page catalog-collection catalog-collection-${kind}`}>
    <header className="album-hero" onContextMenu={onCollectionMenu}>
      {collection.artwork_url && <div className="album-hero-background" aria-hidden="true"><Artwork src={collection.artwork_url} size={512} /></div>}
      <button className="artist-back" type="button" aria-label={`Back from ${kind}`} onClick={onBack}><ArrowLeft size={20} /></button>
      <Artwork className="album-cover" src={collection.artwork_url} size={224} />
      <div className="album-heading"><span className="detail-type">{category || (kind === "album" ? "Album" : "Playlist")}</span><h1>{collection.title}</h1>
        <div className="album-byline">
          {("artist" in collection || collection.author) && <div className="album-artist">{"artist" in collection ? tracks[0] ? <ArtistLinks track={{ ...tracks[0], artist: collection.artist || tracks[0].artist }} onOpen={onArtist} /> : collection.artist : collection.author}</div>}
          <div className="album-details">
            {"year" in collection && collection.year && <span><CalendarDays aria-hidden="true" />Released in {collection.year}</span>}
            <span><ListMusic aria-hidden="true" />{tracks.length} {tracks.length === 1 ? "song" : "songs"} total</span>
          </div>
        </div>
        {collection.description && <p className="album-description">{collection.description}</p>}
        <div className="artist-hero-actions"><button type="button" disabled={!tracks.length || loading} onClick={() => play(tracks[0])}><Play size={18} fill="currentColor" />Play</button><button className="album-shuffle" type="button" disabled={!tracks.length || loading} onClick={shuffle}><Shuffle size={19} />Shuffle</button>{onCollectionMenu && <button type="button" className="catalog-collection-options" aria-label="Playlist options" onClick={onCollectionMenu}><MoreHorizontal size={20} /></button>}</div>
      </div>
    </header>
    <section className="artist-catalog" aria-label={`${kind === "album" ? "Album" : "Playlist"} songs`}>
      {kind === "playlist" && <label className="collection-search-label catalog-playlist-search"><Search className="search-icon" size={16} /><input className="player-search-input" type="search" aria-label={searchLabel} placeholder={searchLabel} value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
      <div className="album-columns"><span>#</span><span>Title</span><span className="album-duration-heading"><Clock3 size={16} aria-label="Duration" /></span></div>
      {loadError ? <><PlayerAlert message={loadError} onDismiss={() => {}} />{onRetry && <button type="button" className="artist-secondary" onClick={onRetry}>try again</button>}</> : loading ? <p className="feed-message loading-state" role="status"><Classic />finding your next favorites...</p> : visibleTracks.length ? visibleTracks.map((track, index) => <div className="catalog-song" key={track.id} onContextMenu={(event) => openSongMenu(event, { ...track, album_id: track.album_id || (kind === "album" ? id : "") }, onCollectionMenu ? { kind: "playlist", id } : undefined)} onClick={(event) => { if (event.target instanceof Element && event.target.closest("button, .artist-links")) return; play(track); }}>
        <span className="catalog-song-number">{index + 1}</span>
        <button className="catalog-song-cover" type="button" aria-label={`Play ${track.title}`} onClick={() => play(track)}><Artwork src={kind === "album" ? collection.artwork_url || track.album_art_url : track.album_art_url} size={48} lazy /><PlayingSpectrum active={current?.id === track.id} playing={playing} size={28} /><span><Play size={16} fill="currentColor" /></span></button>
        <div className="catalog-song-info"><button className="song-menu-title" type="button" onContextMenu={(event) => openSongMenu(event, { ...track, album_id: track.album_id || (kind === "album" ? id : "") }, onCollectionMenu ? { kind: "playlist", id } : undefined)} onClick={() => play(track)}><MarqueeText>{track.title}</MarqueeText></button><MarqueeText><ArtistLinks track={track} onOpen={onArtist} /></MarqueeText></div>
        <span className="catalog-song-duration"><ExplicitBadge explicit={track.is_explicit} /><span>{trackDurationLabel(track)}</span></span>
      </div>) : <p className="feed-message">{query.trim() ? "no songs match your search" : `no songs in this ${kind} yet`}</p>}
    </section>
  </div>;
}
