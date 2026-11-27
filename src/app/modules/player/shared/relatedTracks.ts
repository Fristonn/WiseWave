import { Music, type Track } from "../../../mygo";

const relatedCache = new Map<string, Track[]>();
const relatedRequests = new Map<string, Promise<Track[]>>();

export function loadRelatedTracks(id: string, refresh = false) {
  const cached = relatedCache.get(id);
  if (cached && !refresh) return Promise.resolve(cached);
  const pending = relatedRequests.get(id);
  if (pending) return pending;
  const request = Music.related(id).then((tracks) => {
    const related = (tracks ?? []).filter((track) => track.id !== id);
    if (relatedCache.size >= 64) relatedCache.delete(relatedCache.keys().next().value!);
    relatedCache.set(id, related);
    return related;
  }).finally(() => relatedRequests.delete(id));
  relatedRequests.set(id, request);
  return request;
}

export async function loadMix(track: Track) {
  return [track, ...await loadRelatedTracks(track.id)];
}

export function cachedMix(track: Track) {
  const related = relatedCache.get(track.id);
  return related ? [track, ...related] : undefined;
}

export function clearRelatedTracks(id: string) {
  relatedCache.delete(id);
}
