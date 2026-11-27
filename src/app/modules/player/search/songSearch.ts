import { Music, type Track } from "../../../mygo";

const PAGE_SIZE = 30;
const MAX_PROVIDER_PAGES = 8;

export type SongSearchCursor = {
  continuation: string;
  buffered: Track[];
  seenTracks: Set<string>;
  seenTokens: Set<string>;
};

export type SongSearchPage = {
  tracks: Track[];
  next?: SongSearchCursor;
};

export async function loadSongSearchPage(
  query: string,
  cursor: SongSearchCursor | undefined,
  signal: AbortSignal,
  savedTrackIds: ReadonlySet<string>,
  onPartial: (tracks: Track[]) => void,
): Promise<SongSearchPage> {
  signal.throwIfAborted();
  const found = (cursor?.buffered ?? []).filter((track) => !savedTrackIds.has(track.id));
  const seenTracks = new Set(cursor?.seenTracks);
  const seenTokens = new Set(cursor?.seenTokens);
  let continuation = cursor?.continuation ?? "";
  let first = !cursor;
  if (found.length && found.length < PAGE_SIZE) onPartial(found.slice());

  for (let calls = 0; calls < MAX_PROVIDER_PAGES && found.length < PAGE_SIZE && (first || continuation); calls++) {
    signal.throwIfAborted();
    const page = await Music.searchSongs(query, continuation);
    signal.throwIfAborted();
    if (!page) throw new Error("Song search returned no page");
    first = false;
    if (continuation) seenTokens.add(continuation);
    const previousCount = found.length;
    for (const track of page.tracks) {
      if (!track.id || seenTracks.has(track.id) || savedTrackIds.has(track.id)) continue;
      seenTracks.add(track.id);
      found.push(track);
    }
    continuation = page.continuation ?? "";
    if (seenTokens.has(continuation)) continuation = "";
    if (found.length > previousCount && found.length < PAGE_SIZE && continuation) onPartial(found.slice());
  }

  const buffered = found.slice(PAGE_SIZE);
  return {
    tracks: found.slice(0, PAGE_SIZE),
    next: buffered.length || continuation ? { continuation, buffered, seenTracks, seenTokens } : undefined,
  };
}
