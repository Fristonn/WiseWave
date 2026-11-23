import type { Line } from "../../../mygo";
import type { LyricLine } from "../../../types/lyricRenderer";

export function normalizeLyricLines(rawLines: Line[], durationMs = Infinity): LyricLine[] {
  const ordered = rawLines.map((raw) => {
    const backgroundOnly = raw.syllables?.some(unit => unit.is_background)
      ? raw.syllables.every(unit => unit.is_background)
      : Boolean(raw.is_background);
    const timedBackground = backgroundOnly ? raw.syllables?.filter(unit => Number.isFinite(unit.start_time_ms) && Number.isFinite(unit.end_time_ms) && unit.end_time_ms > unit.start_time_ms) : undefined;
    const firstLead = raw.syllables?.find(unit => !unit.is_background);
    const leadStart = raw.start_time_ms === 0 && firstLead && Number.isFinite(firstLead.start_time_ms) &&
      firstLead.start_time_ms > 0 && firstLead.start_time_ms < durationMs ? firstLead.start_time_ms : raw.start_time_ms;
    const start = timedBackground?.length ? Math.min(...timedBackground.map(unit => unit.start_time_ms)) : leadStart;
    return { raw, backgroundOnly, timedBackground, start };
  }).filter(({ start }) => Number.isFinite(start) && start >= 0 && start < durationMs)
    .sort((a, b) => a.start - b.start);
  let nextLeadStart: number | undefined;
  const nextStarts = ordered.map(() => 0);
  for (let index = ordered.length - 1; index >= 0; index--) {
    nextStarts[index] = nextLeadStart ?? ordered[index].start;
    if (!ordered[index].backgroundOnly) nextLeadStart = ordered[index].start;
  }
  const lines = ordered.map(({ raw, backgroundOnly, timedBackground, start }, index) => {
    const nextStart = nextStarts[index];
    const instrumental = !raw.text?.trim() || raw.text.trim() === "\u266a";
    const inferredEnd = nextStart > start && (instrumental || nextStart - start <= 6000) ? nextStart : start + 4500;
    const suppliedEnd = timedBackground?.length
      ? Math.max(...timedBackground.map(unit => unit.end_time_ms))
      : raw.end_time_ms > start ? raw.end_time_ms : raw.syllables?.at(-1)?.end_time_ms ?? 0;
    const validEnd = Number.isFinite(suppliedEnd) && suppliedEnd > start && suppliedEnd <= durationMs + 2000;
    const end = Math.min(durationMs, Math.max(start + 100, validEnd ? suppliedEnd : inferredEnd));
    const units = raw.syllables;
    const validUnits = units?.every((unit, unitIndex) => Number.isFinite(unit.start_time_ms) && unit.start_time_ms >= (unit.is_background ? 0 : start) &&
      unit.start_time_ms < end && (unitIndex === 0 || unit.start_time_ms >= units[unitIndex - 1].start_time_ms));
    return {
      startTimeMs: start,
      endTimeMs: end,
      text: instrumental ? "" : raw.text,
      isBackground: backgroundOnly,
      transliteration: raw.transliteration,
      syllables: instrumental || !validUnits ? undefined : units?.map((unit, unitIndex) => {
        const next = units[unitIndex + 1]?.start_time_ms ?? 0;
        const unitEnd = Number.isFinite(unit.end_time_ms) && unit.end_time_ms > unit.start_time_ms ? unit.end_time_ms : next > unit.start_time_ms ? next : unit.start_time_ms + 150;
        return {
          startTimeMs: unit.start_time_ms,
          endTimeMs: Math.max(unit.start_time_ms, Math.min(Math.max(unit.start_time_ms + 50, unitEnd), next > unit.start_time_ms ? next : Infinity, end > unit.start_time_ms ? end : Infinity)),
          text: unit.text,
          isBackground: unit.is_background,
          appendToPrevious: unit.append_to_previous,
        };
      }),
      accompanimentLines: [] as LyricLine[],
    };
  });
  const main = lines.filter(line => !line.isBackground);
  if (!main.length) return lines.map(line => ({ ...line, isBackground: false }));
  for (const line of lines) {
    if (line.isBackground) {
      const owner = main.reduce((best, candidate) => {
        const overlap = Math.max(0, Math.min(candidate.endTimeMs, line.endTimeMs) - Math.max(candidate.startTimeMs, line.startTimeMs));
        const bestOverlap = Math.max(0, Math.min(best.endTimeMs, line.endTimeMs) - Math.max(best.startTimeMs, line.startTimeMs));
        return overlap > bestOverlap || (overlap === bestOverlap && Math.abs(candidate.startTimeMs - line.startTimeMs) < Math.abs(best.startTimeMs - line.startTimeMs)) ? candidate : best;
      });
      owner.accompanimentLines.push(line);
      continue;
    }
    const background = line.syllables?.filter(unit => unit.isBackground) ?? [];
    const lead = line.syllables?.filter(unit => !unit.isBackground) ?? [];
    if (background.length && lead.length) {
      line.syllables = lead;
      line.accompanimentLines.push({
        startTimeMs: background[0].startTimeMs,
        endTimeMs: background.at(-1)!.endTimeMs,
        text: background.map(unit => unit.text).join(""),
        syllables: background,
        isBackground: true,
      });
    }
  }
  return main;
}
