import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Download, Check, ChevronRight, Disc3, Heart, ListPlus, Plus, Radio, Search, Trash2 } from "lucide-react";
import { SongInfoIcon } from "../../../shared/ui/icons";
import { useSnackbar } from "../../../shared/ui/Snackbar";
import { Clipboard as NativeClipboard, Music, type Track } from "../../../mygo";
import type { Playlist } from "../library/useLibrary";
import { PlaylistDialog } from "../library/PlaylistDialog";
import { DeleteConfirmation } from "../library/PlaylistMenu";
import { artistNames } from "./ArtistLinks";
import type { DownloadState } from "../downloads/useDownloads";

type Location = { kind: "downloads" } | { kind: "liked" } | { kind: "playlist"; id: string } | { kind: "queue"; index: number };
type MenuState = { track: Track; x: number; y: number; location?: Location };
type OpenMenu = (event: MouseEvent, track: Track, location?: Location) => void;
const SongMenuContext = createContext<OpenMenu | null>(null);
export function useSongMenu() {
  const open = useContext(SongMenuContext);
  if (!open) throw new Error("Song menu is unavailable");
  return open;
}

export function SongMenuTarget({ track, className, children }: { track: Track; className: string; children: ReactNode }) {
  const open = useSongMenu();
  return <div className={className} onContextMenu={(event) => open(event, track)}>{children}</div>;
}

export function SongMenuProvider({ children, liked, playlists, onLike, onAdd, onCreateAndAdd, onRemove, onQueue, onRemoveQueue, onArtist, onAlbum, onRadio, onError, onDownload, onDeleteDownload, downloadState }: {
  children: ReactNode;
  liked: Track[];
  playlists: Playlist[];
  onLike: (track: Track) => void;
  onAdd: (id: string, track: Track) => void;
  onCreateAndAdd: (name: string, description: string, track: Track, cover?: string) => void;
  onRemove?: (id: string, track: Track) => void;
  onQueue: (track: Track) => void;
  onRemoveQueue?: (index: number, track: Track) => void;
  onArtist: (track: Track) => void;
  onAlbum: (id: string, track: Track) => void;
  onRadio: (track: Track) => void;
  onError: (message: string) => void;
  onDownload: (track: Track) => void;
  onDeleteDownload: (track: Track) => Promise<void>;
  downloadState: (id: string) => DownloadState;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [submenu, setSubmenu] = useState(false);
  const [filter, setFilter] = useState("");
  const [createFor, setCreateFor] = useState<Track | null>(null);
  const notify = useSnackbar();
  const [deleteFor, setDeleteFor] = useState<Track | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0, flip: false });
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const close = useCallback((restore = false) => {
    setMenu(null);
    if (restore) previousFocus.current?.focus();
  }, []);
  const open = useCallback<OpenMenu>((event, track, location) => {
    event.preventDefault();
    event.stopPropagation();
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSubmenu(false);
    setFilter("");
    const rect = event.currentTarget.getBoundingClientRect();
    const anchored = event.type === "click" || (event.clientX === 0 && event.clientY === 0);
    setMenu({ track, x: anchored ? rect.left : event.clientX, y: anchored ? rect.bottom : event.clientY, location });
  }, []);

  useLayoutEffect(() => {
    if (!menu || !root.current) return;
    const { width, height } = root.current.getBoundingClientRect();
    const submenuHeight = root.current.querySelector<HTMLElement>(".song-menu-submenu")?.offsetHeight ?? 0;
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - width - 8));
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - Math.max(height, submenuHeight) - 8));
    setPosition({ x, y, flip: x + width + 224 > window.innerWidth - 8 });
  }, [menu, submenu, filter, playlists.length]);

  useLayoutEffect(() => {
    if (menu) root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => {
      const element = event.target instanceof HTMLElement ? event.target : null;
      if (event.key === "Escape" || (event.key === "ArrowLeft" && element?.closest(".song-menu-submenu"))) {
        event.preventDefault();
        if (submenu) { setSubmenu(false); root.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus(); }
        else close(true);
        return;
      }
      if (event.key === "ArrowRight" && element?.getAttribute("aria-haspopup") === "menu") {
        event.preventDefault();
        setSubmenu(true);
        requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('.song-menu-submenu [role="menuitem"]')?.focus());
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (element?.tagName === "INPUT") return;
      const currentMenu = element?.closest('[role="menu"]');
      const items = Array.from(currentMenu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(element as HTMLButtonElement);
      items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    };
    const dismiss = (event: Event) => { if (!(event.target instanceof Node) || !root.current?.contains(event.target)) close(); };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [menu, submenu, close]);

  const track = menu?.track;
  const saved = Boolean(track && liked.some((item) => item.id === track.id));
  const download = track ? downloadState(track.id) : undefined;
  const firstArtist = track ? artistNames(track.artist)[0] : undefined;
  const playlistId = menu?.location?.kind === "playlist" ? menu.location.id : undefined;
  const queueIndex = menu?.location?.kind === "queue" ? menu.location.index : undefined;
  const matching = playlists.filter((playlist) => playlist.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const perform = (action: () => void) => { action(); close(true); };

  return <SongMenuContext.Provider value={open}>
    {children}
    {deleteFor && <DeleteConfirmation title="Delete this download?" description={<>This will remove <strong>{deleteFor.title}</strong> from your downloads.</>} onCancel={() => setDeleteFor(null)} onConfirm={() => { const selected = deleteFor; setDeleteFor(null); void onDeleteDownload(selected); }} />}
    {createFor && <PlaylistDialog onClose={() => setCreateFor(null)} onCreate={(name, description, cover) => { onCreateAndAdd(name, description, createFor, cover); setCreateFor(null); }} />}
    {menu && track && createPortal(
      <div ref={root} className="song-menu" style={{ left: position.x, top: position.y }} onContextMenu={(event) => event.preventDefault()}>
        <div className="song-menu-list" role="menu" aria-label={`Options for ${track.title}`}>
          <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onQueue(track))}><ListPlus /><span>Add to queue</span></button>
          <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={submenu} onPointerEnter={() => setSubmenu(true)} onClick={() => setSubmenu(true)}><svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M14.25 11.25A.75.75 0 0115 12v1.5h1.5a.75.75 0 010 1.5H15v1.5a.75.75 0 01-1.5 0V15H12a.75.75 0 010-1.5h1.5V12a.75.75 0 01.75-.75Zm-4.5 3H3a.75.75 0 010-1.5h6.75v1.5Zm5.25-6a.75.75 0 010 1.5H3a.75.75 0 010-1.5h12Zm0-4.5a.75.75 0 010 1.5H3a.75.75 0 010-1.5h12Z" /></svg><span>Add to playlist</span><ChevronRight /></button>
          <button type="button" role="menuitem" className={saved ? "song-menu-danger" : undefined} onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onLike(track))}><Heart className={saved ? "song-menu-liked" : undefined} fill={saved ? "currentColor" : "none"} /><span>{saved ? "Remove from Liked Songs" : "Save to Liked Songs"}</span></button>
          <div className="song-menu-divider" role="separator" />
          <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onRadio(track))}><Radio /><span>Play Mix</span></button>
          {firstArtist && <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onArtist({ ...track, artist: firstArtist }))}><svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M9 1.5A3.75 3.75 0 109 9a3.75 3.75 0 000-7.5ZM9 3a2.25 2.25 0 110 4.5A2.25 2.25 0 019 3Zm5.25 6.665v3.216a2.244 2.244 0 00-3 2.119 2.25 2.25 0 004.5 0v-3.226l1.96 1.177a.192.192 0 00.29-.164V11.48a.38.38 0 00-.18-.32l-3-1.815a.375.375 0 00-.57.32ZM9 9.75a6 6 0 00-6 6 .75.75 0 101.5 0 4.5 4.5 0 016.84-3.842l1.084-1.083A6 6 0 009 9.75Zm4.5 4.5a.75.75 0 110 1.5.75.75 0 010-1.5Z" /></svg><span>Go to artist</span></button>}
          {track.album_id && <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onAlbum(track.album_id, track))}><Disc3 /><span>Go to album</span></button>}
          <div className="song-menu-divider" role="separator" />
          {download !== "saved" && <button type="button" role="menuitem" disabled={download === "queued" || download === "downloading"} onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onDownload(track))}><Download /><span>{download === "queued" ? "queued for download" : download === "downloading" ? "downloading…" : download === "failed" ? "retry download" : "Download"}</span></button>}
          {download === "saved" && <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => { void Music.revealDownload(track.id).catch(() => onError("couldn't find this download")); close(true); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 5H3" /><path d="M10 12H3" /><path d="M10 19H3" /><circle cx="17" cy="15" r="3" /><path d="m21 19-1.9-1.9" /></svg><span>Show in folder</span></button>}
          <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => { void NativeClipboard.writeText(`https://music.youtube.com/watch?v=${encodeURIComponent(track.id)}`).catch(() => onError("couldn't copy the song link")); close(true); }}><svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M7.5 2.369v3.263c-4.394.18-6.529 3.25-6.733 9.795-.011.354.433.513.659.24 2.347-2.838 3.262-3.258 6.074-3.291v3.259a.75.75 0 001.235.572l8.515-7.205-8.515-7.205a.75.75 0 00-1.235.572ZM9 7.07V3.986l5.928 5.016L9 14.017v-3.159l-1.517.018c-1.452.017-2.69.127-3.898.768-.35.186-.683.41-1.01.67.266-1.46.687-2.543 1.222-3.32.797-1.156 1.956-1.789 3.765-1.863L9 7.07Z" /></svg><span>Share</span></button>
          <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => notify({ text: "i'll add that later (too lazy to do all of that)" }))}><SongInfoIcon /><span>Song details</span></button>
          {(playlistId !== undefined || queueIndex !== undefined || download === "saved") && <div className="song-menu-divider" role="separator" />}
          {playlistId !== undefined && onRemove && <button type="button" role="menuitem" className="song-menu-danger" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onRemove(playlistId, track))}><Trash2 /><span>Remove from playlist</span></button>}
          {queueIndex !== undefined && onRemoveQueue && <button type="button" role="menuitem" className="song-menu-danger" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onRemoveQueue(queueIndex, track))}><Trash2 /><span>Remove from queue</span></button>}
          {download === "saved" && <button type="button" role="menuitem" className="song-menu-danger" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => setDeleteFor(track))}><Trash2 /><span>Delete download</span></button>}
        </div>
        {submenu && <div className={`song-menu-submenu ${position.flip ? "flip" : ""}`} role="menu" aria-label="Add to playlist">
          <button type="button" role="menuitem" onClick={() => { setCreateFor(track); close(); }}><Plus /><span>New playlist</span></button>
          <label className="song-menu-search"><Search /><input aria-label="Find a playlist" placeholder="Find a playlist" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
          <div className="song-menu-playlists">
            {matching.map((playlist) => { const contains = playlist.tracks.some((item) => item.id === track.id); return <button type="button" role="menuitem" key={playlist.id} disabled={contains} onClick={() => perform(() => onAdd(playlist.id, track))}><span>{playlist.name}</span>{contains && <Check />}</button>; })}
            {!matching.length && <p>{playlists.length ? "no playlists found" : "no playlists yet"}</p>}
          </div>
        </div>}
      </div>, document.body
    )}
  </SongMenuContext.Provider>;
}
