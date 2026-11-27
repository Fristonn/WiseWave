import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Play, Search } from "lucide-react";
import type { Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { PlayingSpectrum } from "../../../shared/ui/PlayingSpectrum";
import { loadSongSearchPage, type SongSearchCursor, type SongSearchPage } from "../search/songSearch";
import { ArtistLinks } from "../shared/ArtistLinks";
import { ExplicitBadge } from "../shared/ExplicitBadge";
import { loadRelatedTracks } from "../shared/relatedTracks";
import { useSongMenu } from "../shared/SongMenu";
import { trackDurationLabel } from "../shared/trackDuration";

const recommendationLimit = 8;
const recommendationBucketLimit = 6;

function recommendationSeeds(tracks: Track[]) {
  const ids = [...new Set(tracks.map((track) => track.id).filter((id) => /^[\w-]{11}$/.test(id)))];
  return [...new Set([ids[0], ids[Math.floor(ids.length / 2)], ids.at(-1)])].filter(Boolean).join(",");
}

function recommendedTracks(buckets: Track[][], excluded: Set<string>, limit: number) {
  const found = new Map<string, Track>();
  const longest = Math.max(0, ...buckets.map((bucket) => bucket.length));
  for (let index = 0; index < longest && found.size < limit; index++) {
    for (const bucket of buckets) {
      const track = bucket[index];
      if (track?.id && !excluded.has(track.id) && !found.has(track.id)) found.set(track.id, track);
      if (found.size === limit) break;
    }
  }
  return [...found.values()];
}

async function loadRecommendationBuckets(seeds: string[], fresh: boolean) {
  const results = await Promise.allSettled(seeds.map((id) => loadRelatedTracks(id, fresh)));
  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

type SongPickerActions = {
  onAdd: (track: Track) => void;
  onArtist: (track: Track) => void;
  playback: { play: (track: Track, tracks: Track[]) => void; currentTrackId?: string; playing: boolean };
};

function SongPickerRows({ tracks, onAdd, onArtist, numbered = false, playback }: SongPickerActions & {
  tracks: Track[]; numbered?: boolean;
}) {
  const openSongMenu = useSongMenu();
  const List = numbered ? "ol" : "ul";
  return <List className={`playlist-picker-results${numbered ? " playlist-picker-numbered" : ""}`}>
    {tracks.map((track, index) => <li className="playlist-picker-row" key={track.id}
      onPointerDown={(event) => { if (event.button === 2) event.preventDefault(); }}
      onKeyDown={(event) => { if (event.key === " " && event.target instanceof HTMLButtonElement) event.stopPropagation(); }}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("button, .artist-links")) return;
        playback.play(track, tracks);
      }}
      onContextMenu={(event) => openSongMenu(event, track)}>
      {numbered && <span className="playlist-picker-number" aria-hidden="true">{index + 1}</span>}
      <button className="catalog-song-cover playlist-picker-cover" type="button" aria-label={`Play ${track.title}`} onClick={() => playback.play(track, tracks)}>
        <Artwork src={track.album_art_url} size={40} lazy />
        <PlayingSpectrum active={playback.currentTrackId === track.id} playing={playback.playing} size={24} />
        <span aria-hidden="true"><Play size={16} fill="currentColor" /></span>
      </button>
      <div className="playlist-picker-track">
        <div className="playlist-picker-track-title">
          <button className="playlist-picker-title-button song-menu-title" type="button" onClick={() => playback.play(track, tracks)}>
            <MarqueeText tooltip={false}>{track.title}</MarqueeText>
          </button>
          <ExplicitBadge explicit={track.is_explicit} />
        </div>
        {track.artist && <MarqueeText className="playlist-picker-byline" title={track.artist} tooltip={false}><ArtistLinks track={track} onOpen={onArtist} /></MarqueeText>}
      </div>
      <span className="playlist-picker-duration">{trackDurationLabel(track, "")}</span>
      <button className="settings-btn playlist-picker-button playlist-picker-track-action" type="button"
        aria-label={`Add ${track.title} to playlist`}
        onClick={(event) => {
          const button = event.currentTarget;
          if (document.activeElement === button) {
            const row = button.closest("li");
            const neighbor = row?.nextElementSibling ?? row?.previousElementSibling;
            const next = neighbor?.querySelector<HTMLElement>(".playlist-picker-track-action")
              ?? button.closest<HTMLElement>(".playlist-picker-scroll")
              ?? button.closest("section")?.querySelector<HTMLElement>(".playlist-picker-refresh button");
            next?.focus({ preventScroll: true });
          }
          onAdd(track);
        }}>
        Add
      </button>
    </li>)}
  </List>;
}

function SongSearchResults({ query, active, savedTrackIds, onAdd, onArtist, playback }: SongPickerActions & {
  query: string; active: boolean; savedTrackIds: ReadonlySet<string>;
}) {
  const [result, setResult] = useState<SongSearchPage & { query: string; partialTracks: Track[]; needsManualLoad: boolean }>();
  const [status, setStatus] = useState<{ query: string; state: "loading" | "ready" | "failed" }>();
  const request = useRef<AbortController | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const excluded = useRef(savedTrackIds);

  useLayoutEffect(() => { excluded.current = savedTrackIds; }, [savedTrackIds]);
  useLayoutEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0;
  }, [result?.query]);

  const load = useCallback((cursor?: SongSearchCursor) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setStatus({ query, state: "loading" });
    const publish = (page: SongSearchPage, partial = false) => {
      if (controller.signal.aborted) return;
      setResult((previous) => {
        const committed = cursor && previous?.query === query ? previous.tracks : [];
        return {
          query,
          tracks: partial ? committed : [...committed, ...page.tracks],
          partialTracks: partial ? page.tracks : [],
          next: page.next,
          needsManualLoad: !partial && page.tracks.length === 0,
        };
      });
    };
    void loadSongSearchPage(query, cursor, controller.signal, excluded.current, (tracks) => publish({ tracks, next: cursor }, true)).then((page) => {
      if (controller.signal.aborted) return;
      publish(page);
      setStatus({ query, state: "ready" });
    }).catch(() => {
      if (!controller.signal.aborted) setStatus({ query, state: "failed" });
    }).finally(() => {
      if (request.current === controller) request.current = null;
    });
  }, [query]);

  useLayoutEffect(() => {
    setStatus({ query, state: "loading" });
    const timer = window.setTimeout(() => load(), 80);
    return () => {
      window.clearTimeout(timer);
      request.current?.abort();
      request.current = null;
    };
  }, [load, query]);

  const current = result?.query === query ? result : undefined;
  const loading = status?.query !== query || status.state === "loading";
  const failed = status?.query === query && status.state === "failed";
  const next = current?.next;
  const needsManualLoad = current?.needsManualLoad;
  useEffect(() => {
    const root = scrollArea.current;
    const target = sentinel.current;
    if (!root || !target || !next || loading || failed || !active || needsManualLoad) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) load(next);
    }, { root, rootMargin: "0px 0px 96px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [active, failed, load, loading, needsManualLoad, next]);

  const tracks = [...(result?.tracks ?? []), ...(result?.partialTracks ?? [])].filter((track) => !savedTrackIds.has(track.id));
  return <div ref={scrollArea} className="playlist-picker-scroll player-scroll" role="region" aria-label="Song results" aria-busy={loading} tabIndex={tracks.length ? 0 : -1}>
    {tracks.length > 0 && <SongPickerRows tracks={tracks} onAdd={onAdd} onArtist={onArtist} playback={playback} />}
    {failed && <p className="playlist-picker-status" role="status">
      {current && tracks.length ? "couldn't load more songs" : "couldn't search right now"}
      <button className="settings-btn playlist-picker-button" type="button" onClick={() => load(next)}>try again</button>
    </p>}
    {!loading && !failed && tracks.length === 0 && !next && <p className="playlist-picker-status" role="status">no songs found</p>}
    {next && !loading && !failed && (needsManualLoad
      ? <div className="playlist-picker-status"><button className="settings-btn playlist-picker-button" type="button" onClick={() => load(next)}>Load more</button></div>
      : <div ref={sentinel} className="playlist-picker-page-end" aria-hidden="true" />)}
  </div>;
}

export function PlaylistSongPicker({ tracks, savedTrackIds, onAdd, onArtist, playback }: SongPickerActions & {
  tracks: Track[]; savedTrackIds: ReadonlySet<string>;
}) {
  const [searching, setSearching] = useState(false);
  const [searchHeight, setSearchHeight] = useState<number>();
  const [query, setQuery] = useState("");
  const [recommendations, setRecommendations] = useState<{ buckets: Track[][]; refresh: number; failed: boolean }>();
  const [shown, setShown] = useState<{ tracks: Track[]; refresh: number }>({ tracks: [], refresh: 0 });
  const [refresh, setRefresh] = useState(0);
  const completedRefresh = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const emptyButton = useRef<HTMLButtonElement>(null);
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const focusAfterUpdate = useRef<"input" | "empty" | null>(null);
  const editAnchor = useRef<{ top: number; scroll: HTMLElement } | null>(null);
  const titleID = useId();
  const seeds = recommendationSeeds(tracks);
  const rows = useMemo(() => shown.tracks.filter((track) => !savedTrackIds.has(track.id)), [shown.tracks, savedTrackIds]);
  const showEmpty = !tracks.length && !searching;
  const searchQuery = query.trim();

  const startSearch = () => {
    if (searching) return;
    setSearchHeight(stage.current?.offsetHeight);
    setSearching(true);
  };

  const addTrack = (track: Track) => {
    if (savedTrackIds.has(track.id)) return;
    onAdd(track);
  };

  const addFromSearch = (track: Track) => {
    const input = searchInput.current;
    const scroll = input?.closest<HTMLElement>(".home-view");
    if (input && scroll) editAnchor.current = { top: input.getBoundingClientRect().top, scroll };
    addTrack(track);
  };

  useEffect(() => {
    if (!searching) return;
    const leaveSearch = (event: Event) => {
      if (event.target instanceof Element && !section.current?.contains(event.target) && !event.target.closest(".song-menu")) setSearching(false);
    };
    document.addEventListener("focusin", leaveSearch);
    document.addEventListener("pointerdown", leaveSearch, true);
    return () => {
      document.removeEventListener("focusin", leaveSearch);
      document.removeEventListener("pointerdown", leaveSearch, true);
    };
  }, [searching]);

  useLayoutEffect(() => {
    const target = focusAfterUpdate.current;
    focusAfterUpdate.current = null;
    if (target === "input") searchInput.current?.focus();
    if (target === "empty") emptyButton.current?.focus({ preventScroll: true });
  }, [searching]);

  useLayoutEffect(() => {
    const anchor = editAnchor.current;
    editAnchor.current = null;
    const picker = section.current;
    const input = searchInput.current;
    if (!picker) return;
    if (!searching) {
      picker.style.removeProperty("--playlist-search-top-room");
      picker.style.removeProperty("--playlist-search-bottom-room");
      return;
    }
    if (!anchor || !input || !anchor.scroll.offsetHeight) return;
    const delta = input.getBoundingClientRect().top - anchor.top;
    const scale = anchor.scroll.getBoundingClientRect().height / anchor.scroll.offsetHeight;
    if (scale <= 0 || Math.abs(delta) <= 0.5) return;
    const offset = anchor.scroll.scrollTop + delta / scale;
    const scrollLimit = anchor.scroll.scrollHeight - anchor.scroll.clientHeight;
    const neededRoom = offset < 0 ? -offset : offset - scrollLimit;
    if (neededRoom > 0.5) {
      const property = offset < 0 ? "--playlist-search-top-room" : "--playlist-search-bottom-room";
      const currentRoom = Number.parseFloat(picker.style.getPropertyValue(property)) || 0;
      picker.style.setProperty(property, `${currentRoom + Math.ceil(neededRoom)}px`);
    }
    anchor.scroll.scrollTop = Math.max(0, offset);
  });

  useEffect(() => {
    if (!seeds) {
      setRecommendations(undefined);
      return;
    }
    let active = true;
    const fresh = refresh !== completedRefresh.current;
    void loadRecommendationBuckets(seeds.split(","), fresh).then((buckets) => {
      if (!active) return;
      completedRefresh.current = refresh;
      setRecommendations((previous) => !buckets.length && previous
        ? previous
        : { buckets, refresh: fresh ? refresh : previous?.refresh ?? 0, failed: buckets.length === 0 });
    });
    return () => { active = false; };
  }, [refresh, seeds]);

  useLayoutEffect(() => {
    if (!seeds) {
      if (shown.tracks.length) setShown({ ...shown, tracks: [] });
      return;
    }
    if (!recommendations) return;
    const retained = shown.tracks.filter((track) => !savedTrackIds.has(track.id));
    const excluded = new Set([...savedTrackIds, ...retained.map((track) => track.id)]);
    if (recommendations.refresh > shown.refresh) {
      const fresh = recommendedTracks(recommendations.buckets, excluded, recommendationLimit);
      const fallback = recommendedTracks(recommendations.buckets, new Set([...savedTrackIds, ...fresh.map((track) => track.id)]), recommendationLimit - fresh.length);
      const replacement = [...fresh, ...fallback];
      setShown({ tracks: replacement.length ? replacement : retained, refresh: recommendations.refresh });
      return;
    }

    const more = recommendedTracks(recommendations.buckets, excluded, recommendationLimit - retained.length);
    if (more.length || retained.length !== shown.tracks.length) {
      setShown({ ...shown, tracks: [...retained, ...more] });
    }
    if (retained.length + more.length >= shown.tracks.length) return;

    const savedSeeds = shown.tracks.filter((track) => savedTrackIds.has(track.id));
    const refillSeeds = recommendationSeeds([...savedSeeds, ...tracks]);
    void loadRecommendationBuckets(refillSeeds.split(","), true).then((buckets) => {
      if (!buckets.some((bucket) => bucket.length)) return;
      setRecommendations((current) => current?.refresh === recommendations.refresh
        ? { ...current, buckets: [...current.buckets, ...buckets].slice(-recommendationBucketLimit) }
        : current);
    });
  }, [recommendations, savedTrackIds, seeds, shown, tracks]);

  return <section ref={section} className="playlist-song-picker" aria-labelledby={titleID} data-searching={searching}
    onBlur={(event) => {
      if (searching && !event.currentTarget.contains(event.relatedTarget)
        && !(event.relatedTarget instanceof Element && event.relatedTarget.closest(".song-menu"))) setSearching(false);
    }}
    onKeyDown={(event) => {
      if (!searching || event.key !== "Escape" || event.nativeEvent.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (!tracks.length) focusAfterUpdate.current = "empty";
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setQuery("");
      setSearching(false);
    }}>
    <div className="playlist-picker-heading" data-empty={showEmpty}>
      <h2 id={showEmpty ? undefined : titleID}>{searching ? "Search songs" : "Recommended"}</h2>
      <label className="collection-search-label playlist-picker-search">
        <Search className="search-icon" size={16} aria-hidden="true" />
        <input ref={searchInput} className="player-search-input" type="search" aria-label="Search songs to add" placeholder="Search songs to add" value={query} onFocus={startSearch} onChange={(event) => setQuery(event.target.value)} />
      </label>
    </div>
    <div ref={stage} className="playlist-picker-stage" style={searching ? { blockSize: searchHeight } : undefined}>
      {showEmpty && <div className="playlist-empty-songs">
        <h2 id={titleID}>start with a song</h2>
        <button ref={emptyButton} className="settings-btn playlist-picker-button" type="button" onClick={() => {
          focusAfterUpdate.current = "input";
          startSearch();
        }}>Add Songs</button>
      </div>}
      <div hidden={searching || showEmpty}>
        {rows.length > 0 ? <SongPickerRows tracks={rows} onAdd={addTrack} onArtist={onArtist} playback={playback} numbered />
          : (recommendations || !seeds) && <p className="playlist-picker-status" role="status">
            {recommendations?.failed ? "couldn't load recommendations" : "no recommendations yet"}
          </p>}
        {seeds && <div className="playlist-picker-refresh">
          <button className="playlist-picker-button" type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
        </div>}
      </div>
      <div className="playlist-picker-search-panel" hidden={!searching}>
        {searchQuery && <SongSearchResults query={searchQuery} active={searching} savedTrackIds={savedTrackIds} onAdd={addFromSearch} onArtist={onArtist} playback={playback} />}
      </div>
    </div>
  </section>;
}
