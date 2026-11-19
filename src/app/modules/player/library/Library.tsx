import { useEffect, useRef, useState } from "react";
import { Check, ListFilter, ListMusic, Plus, Search } from "lucide-react";
import type { LibraryTrack, Playlist } from "./useLibrary";
import { Artwork } from "../../../shared/ui/Artwork";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { IconButton } from "../../../shared/ui/IconButton";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { trackDurationSeconds } from "../shared/trackDuration";
import { PlaylistDialog } from "./PlaylistDialog";
import { usePlaylistMenu } from "./PlaylistMenu";
import { LikedSongsCover } from "./LikedSongsCover";
import { DownloadsCover } from "../downloads/DownloadsCover";

const sortOptions = ["Library order", "Alphabetical", "Alphabetical (Z–A)", "Most songs", "Fewest songs", "Longest", "Shortest"] as const;
type LibrarySort = (typeof sortOptions)[number];
const librarySortKey = "wisewave-library-sort";

function readLibrarySort(): LibrarySort {
  try {
    const saved = localStorage.getItem(librarySortKey);
    return sortOptions.find((option) => option === saved) || "Library order";
  } catch {
    return "Library order";
  }
}

function tracksMeta(tracks: LibraryTrack[]) {
  const songs = tracks.length;
  const minutes = Math.max(0, Math.floor(tracks.reduce((sum, track) => sum + trackDurationSeconds(track), 0) / 60));
  return `${songs} ${songs === 1 ? "song" : "songs"} of ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function Library({ width, liked, playlists, active, onOpen, onCreate, downloadCount, downloadingCount }: { width: number; liked: LibraryTrack[]; playlists: Playlist[]; active: string; onOpen: (id: string) => void; onCreate: (name: string, description: string, cover?: string) => void; downloadCount: number; downloadingCount: number }) {
  const openPlaylistMenu = usePlaylistMenu();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState<LibrarySort>(readLibrarySort);
  const sortRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const syncSort = (event: StorageEvent) => { if (event.key === librarySortKey || event.key === null) setSort(readLibrarySort()); };
    window.addEventListener("storage", syncSort);
    return () => window.removeEventListener("storage", syncSort);
  }, []);
  const selectSort = (option: LibrarySort) => {
    setSort(option);
    try { localStorage.setItem(librarySortKey, option); } catch {}
    setSortOpen(false);
  };
  useEffect(() => {
    if (!sortOpen) return;
    const onPointerDown = (event: PointerEvent) => { if (!sortRef.current?.contains(event.target as Node)) setSortOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSortOpen(false); sortRef.current?.querySelector<HTMLButtonElement>(".library-sort")?.focus(); }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && sortRef.current?.contains(document.activeElement)) {
        const options = Array.from(sortRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        if (options.length) { event.preventDefault(); options[(index + (event.key === "ArrowDown" ? 1 : options.length - 1) + options.length) % options.length].focus(); }
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [sortOpen]);
  const visible = playlists.filter((playlist) => playlist.name.toLowerCase().includes(query.trim().toLowerCase()));
  const compareNames = (a: Playlist, b: Playlist) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  const duration = (playlist: Playlist) => playlist.tracks.reduce((sum, track) => sum + trackDurationSeconds(track), 0);
  const compareDuration = (a: Playlist, b: Playlist, direction: number) => {
    const incompleteA = a.tracks.some((track) => trackDurationSeconds(track) === 0);
    const incompleteB = b.tracks.some((track) => trackDurationSeconds(track) === 0);
    return Number(incompleteA) - Number(incompleteB) || direction * (duration(a) - duration(b)) || compareNames(a, b);
  };
  if (sort === "Alphabetical") visible.sort(compareNames);
  if (sort === "Alphabetical (Z–A)") visible.sort((a, b) => compareNames(b, a));
  if (sort === "Most songs") visible.sort((a, b) => b.tracks.length - a.tracks.length || compareNames(a, b));
  if (sort === "Fewest songs") visible.sort((a, b) => a.tracks.length - b.tracks.length || compareNames(a, b));
  if (sort === "Longest") visible.sort((a, b) => compareDuration(a, b, -1));
  if (sort === "Shortest") visible.sort((a, b) => compareDuration(a, b, 1));

  return <aside className="library" style={{ width }}>
    <div className="library-heading"><span>Your Library</span><div className="library-actions"><Tooltip label="Create playlist"><button className="surface-btn" type="button" onClick={() => setCreating(true)}><Plus size={14} />Create</button></Tooltip></div></div>
    <div className="library-tools"><div className={`library-search ${searchOpen ? "open" : ""}`}><IconButton label="Search in library" onClick={() => { setSortOpen(false); setSearchOpen((open) => !open); }}><Search size={16} /></IconButton><input aria-label="Filter library" placeholder="Filter library" value={query} tabIndex={searchOpen ? 0 : -1} ref={searchInput} onBlur={(event) => { if (!query && !event.currentTarget.parentElement?.contains(event.relatedTarget as Node) && !sortRef.current?.contains(event.relatedTarget as Node)) setSearchOpen(false); }} onChange={(event) => setQuery(event.target.value)} /></div><div className="library-sort-wrap" ref={sortRef}><button className="library-sort" type="button" aria-label={searchOpen ? "Close library search" : "Sort playlists"} aria-haspopup={searchOpen ? undefined : "menu"} aria-expanded={searchOpen ? undefined : sortOpen} onClick={() => { if (searchOpen) { setSearchOpen(false); setQuery(""); } else setSortOpen((open) => !open); }}>{!searchOpen && <span>{sort}</span>}<ListFilter size={17} /></button>{sortOpen && <div className="library-sort-menu" role="menu" aria-label="Sort playlists"><span className="library-sort-heading">Sort by</span>{sortOptions.map((option) => <button key={option} type="button" role="menuitemradio" aria-checked={sort === option} onClick={() => selectSort(option)}>{option}{sort === option && <Check size={17} />}</button>)}</div>}</div></div>
    <div className="library-liked">
      <button className="library-item" type="button" aria-current={active === "liked" ? "page" : undefined} onClick={() => onOpen("liked")}>
        <LikedSongsCover className="liked-cover" />
        <span className="library-item-copy">
          <MarqueeText className="library-item-title">Liked Songs</MarqueeText>
          <MarqueeText className="library-item-meta">{tracksMeta(liked)}</MarqueeText>
        </span>
      </button>
      <button className="library-item" type="button" aria-current={active === "downloads" ? "page" : undefined} onClick={() => onOpen("downloads")}>
        <DownloadsCover className="library-downloads-cover" />
        <span className="library-item-copy">
          <MarqueeText className="library-item-title">Downloads</MarqueeText>
          <MarqueeText className="library-item-meta">{downloadCount} {downloadCount === 1 ? "song" : "songs"}{downloadingCount > 0 ? ` - ${downloadingCount} downloading` : ""}</MarqueeText>
        </span>
      </button>
    </div>
    <nav className="library-list player-scroll" aria-label="Playlists">{visible.length ? visible.map((playlist) => <button className="library-item" type="button" aria-current={active === playlist.id ? "page" : undefined} key={playlist.id} onContextMenu={(event) => openPlaylistMenu(event, playlist)} onClick={() => onOpen(playlist.id)}><span className="playlist-cover">{playlist.cover ? /^(data:|blob:)/i.test(playlist.cover) ? <img src={playlist.cover} alt="" /> : <Artwork src={playlist.cover} size={48} /> : <ListMusic size={20} />}</span><span className="library-item-copy"><MarqueeText className="library-item-title">{playlist.name}</MarqueeText><MarqueeText className="library-item-meta">{tracksMeta(playlist.tracks)}</MarqueeText></span></button>) : <div className="library-empty"><ListMusic size={24} /><strong>no playlists found</strong><span>{query ? "try another search" : "create a playlist to get started"}</span></div>}</nav>
    {creating && <PlaylistDialog onClose={() => setCreating(false)} onCreate={(name, description, cover) => { onCreate(name, description, cover); setCreating(false); }} />}

  </aside>;
}
