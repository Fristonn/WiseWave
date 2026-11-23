const MAX_INTERPOLATION_MS = 500;
const CORRECTION_DURATION_MS = 180;
const MAX_SMOOTH_DRIFT_MS = 1500;
const MAX_UNCONFIRMED_JUMP_MS = 5000;

export interface PlaybackClock {
  read: (now?: number) => number;
  isAdvancing: (now?: number) => boolean;
  isReady: () => boolean;
  update: (positionSec: number, durationSec: number, playing: boolean, trackId?: string, now?: number, seekVersion?: number, offsetMs?: number) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPlaybackClock(): PlaybackClock {
  let positionMs = 0;
  let durationMs = 0;
  let receivedAt = 0;
  let correctionMs = 0;
  let correctionDurationMs = CORRECTION_DURATION_MS;
  let ready = false;
  let playing = false;
  let trackId: string | undefined;
  let lastSeekVersion = 0;
  let lyricOffsetMs = 0;
  let pendingJump: number | null = null;
  const listeners = new Set<() => void>();

  const readPosition = (now: number) => {
    const elapsed = ready && playing ? Math.min(MAX_INTERPOLATION_MS, Math.max(0, now - receivedAt)) : 0;
    const correction = correctionMs * Math.max(0, 1 - elapsed / correctionDurationMs);
    return Math.max(0, Math.min(positionMs + elapsed + correction, durationMs));
  };

  const read = (now = performance.now()) => ready ? readPosition(now) - lyricOffsetMs : 0;
  const isAdvancing = (now = performance.now()) => ready && playing && now - receivedAt < MAX_INTERPOLATION_MS && readPosition(now) < durationMs;
  const notify = () => listeners.forEach(listener => listener());

  return {
    read,
    isAdvancing,
    isReady: () => ready,
    update(positionSec: number, durationSec: number, nextPlaying: boolean, nextTrackId?: string, now = performance.now(), seekVersion = 0, offsetMs = 0) {
      const previousPosition = readPosition(now);
      if (!Number.isFinite(positionSec) || positionSec < 0) return;
      const nextPosition = positionSec * 1000;
      const nextDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec * 1000 : Infinity;
      if (nextPosition > nextDuration + 2000) return;
      const samePlayback = ready && trackId === nextTrackId && seekVersion === lastSeekVersion;
      if (samePlayback && playing && nextPlaying && Math.abs(previousPosition - nextPosition) > MAX_UNCONFIRMED_JUMP_MS) {
        if (pendingJump === null || Math.abs(pendingJump - nextPosition) > MAX_UNCONFIRMED_JUMP_MS) {
          pendingJump = nextPosition;
          return;
        }
      }
      const wasPlaying = playing;
      pendingJump = null;
      ready = Boolean(nextTrackId);
      playing = nextPlaying;
      durationMs = nextDuration;
      const drift = previousPosition - nextPosition;
      correctionMs = samePlayback && wasPlaying && playing && Math.abs(drift) <= MAX_SMOOTH_DRIFT_MS ? drift : 0;
      correctionDurationMs = Math.max(CORRECTION_DURATION_MS, correctionMs * 2);
      trackId = nextTrackId;
      lastSeekVersion = seekVersion;
      positionMs = ready ? nextPosition : 0;
      lyricOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0;
      receivedAt = now;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

