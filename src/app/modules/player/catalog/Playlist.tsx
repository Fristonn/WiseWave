import type { Track } from "../../../mygo";
import { CatalogCollection } from "./CatalogCollection";

export function Playlist({ onPlay, ...props }: { id: string; onBack: () => void; onPlay: (track: Track, tracks: Track[], options?: { collection?: boolean }) => void; onArtist: (track: Track) => void; current?: Track | null; playing?: boolean }) {
  return <CatalogCollection {...props} kind="playlist" onPlay={(track, tracks) => onPlay(track, tracks, { collection: true })} />;
}
