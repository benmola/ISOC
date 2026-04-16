import * as pdfjsLib from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';

// PDF.js worker — loaded from CDN to avoid Vite bundling issues
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// ── Public types (compatible with existing useSchedule / Firestore schema) ──

export interface Prayer {
  name: string;
  athan: string;
  iqama: string;
}

export interface ParsedDay {
  dateStr: string;
  hijriDate?: string;
  sunrise?: string;
  prayers: Prayer[];
}

// ── Internal helpers ────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Detect "April 2025" style text and return 0-indexed month + year. */
function detectMonthYear(text: string): { month: number; year: number } | null {
  const lower = text.toLowerCase();
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const match = lower.match(new RegExp(`${MONTH_NAMES[i]}\\s+(\\d{4})`));
    if (match) return { month: i, year: parseInt(match[1]) };
  }
  return null;
}

/** Pull every HH:MM (24-hour) token from a string. */
function extractTimes(text: string): string[] {
  const times: string[] = [];
  const regex = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) times.push(m[0]);
  return times;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * OCR can split a single table row across two output lines.
 * Merge any continuation line (has times but no leading day-number)
 * back onto the previous day-row.
 */
function mergeRows(rawLines: string[], maxDay: number): string[] {
  const merged: string[] = [];
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    const dayMatch = line.match(/^(\d{1,2})\s/);
    const dayNum = dayMatch ? parseInt(dayMatch[1]) : 0;

    if (dayNum >= 1 && dayNum <= maxDay) {
      merged.push(line);
    } else if (merged.length > 0 && extractTimes(line).length > 0) {
      merged[merged.length - 1] += ' ' + line;
    } else {
      merged.push(line);
    }
  }
  return merged;
}

// ── Core text→data parser ───────────────────────────────────────────────────

/**
 * Parse raw text (from OCR or PDF extraction) into structured prayer-day data.
 *
 * Expected row format (11 time values per day):
 *   DayNum  DayAbbr  FajrBegin FajrIqamah  Sunrise  DhuhrBegin DhuhrIqamah
 *                    AsrBegin  AsrIqamah  MaghribBegin MaghribIqamah
 *                    IshaBegin IshaIqamah
 */
export function parseExtractedText(text: string): ParsedDay[] {
  const monthYear = detectMonthYear(text);
  if (!monthYear) {
    throw new Error(
      'Could not detect the month and year. ' +
      'Make sure the timetable includes text like "April 2025".',
    );
  }

  const { month, year } = monthYear;
  const maxDay = daysInMonth(year, month);
  const lines = mergeRows(text.split('\n'), maxDay);
  const days: ParsedDay[] = [];
  const seen = new Set<number>();

  for (const line of lines) {
    const dayMatch = line.match(/^(\d{1,2})\s/);
    if (!dayMatch) continue;

    const dayNum = parseInt(dayMatch[1]);
    if (dayNum < 1 || dayNum > maxDay || seen.has(dayNum)) continue;

    const times = extractTimes(line);
    if (times.length < 8) continue; // need at least 8 time values to map

    seen.add(dayNum);

    const dateStr =
      `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

    const prayers: Prayer[] = [];
    let sunrise: string | undefined;

    // Standard timetable: 11 times
    // Fajr(begin,iqamah) + Sunrise + Dhuhr(begin,iqamah) + Asr(begin,iqamah)
    // + Maghrib(begin,iqamah) + Isha(begin,iqamah)
    if (times.length >= 11) {
      prayers.push({ name: 'Fajr', athan: times[0], iqama: times[1] });
      sunrise = times[2];
      prayers.push({ name: 'Dhuhr', athan: times[3], iqama: times[4] });
      prayers.push({ name: 'Asr', athan: times[5], iqama: times[6] });
      prayers.push({ name: 'Maghrib', athan: times[7], iqama: times[8] });
      prayers.push({ name: 'Isha', athan: times[9], iqama: times[10] });
    } else if (times.length >= 10) {
      prayers.push({ name: 'Fajr', athan: times[0], iqama: times[1] });
      sunrise = times[2];
      prayers.push({ name: 'Dhuhr', athan: times[3], iqama: times[4] });
      prayers.push({ name: 'Asr', athan: times[5], iqama: times[6] });
      prayers.push({ name: 'Maghrib', athan: times[7], iqama: times[8] });
      prayers.push({ name: 'Isha', athan: times[9], iqama: times[9] });
    } else {
      // Best-effort with fewer columns
      prayers.push({ name: 'Fajr', athan: times[0], iqama: times[1] });
      sunrise = times[2];
      prayers.push({ name: 'Dhuhr', athan: times[3], iqama: times[4] });
      prayers.push({ name: 'Asr', athan: times[5], iqama: times[6] });
      prayers.push({ name: 'Maghrib', athan: times[7], iqama: times[7] });
    }

    days.push({ dateStr, sunrise, prayers });
  }

  days.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

  if (days.length === 0) {
    throw new Error(
      'No prayer times could be extracted. Make sure the document is a clear, ' +
      'tabular prayer timetable with day-numbers and HH:MM times.',
    );
  }

  return days;
}

// ── PDF extraction ──────────────────────────────────────────────────────────

export async function parsePDF(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<ParsedDay[]> {
  onProgress?.('Loading PDF...');

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  let fullText = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.(`Reading page ${pageNum}/${pdf.numPages}...`);
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Group text items by Y coordinate to reconstruct table rows
    const rowMap = new Map<number, Array<{ x: number; text: string }>>();
    for (const item of content.items) {
      const textItem = item as { str: string; transform: number[] };
      if (!textItem.str?.trim()) continue;
      const y = Math.round(textItem.transform[5]);
      const x = textItem.transform[4];
      if (!rowMap.has(y)) rowMap.set(y, []);
      rowMap.get(y)!.push({ x, text: textItem.str });
    }

    // Sort rows top→bottom (PDF Y-axis is bottom-up)
    const sortedRows = [...rowMap.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, cells] of sortedRows) {
      cells.sort((a, b) => a.x - b.x);
      fullText += cells.map((c) => c.text).join(' ') + '\n';
    }
  }

  onProgress?.('Parsing prayer times...');
  return parseExtractedText(fullText);
}

// ── Image OCR extraction ────────────────────────────────────────────────────

export async function parseImage(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<ParsedDay[]> {
  onProgress?.('Initializing text recognition...');

  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress?: number }) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(`Recognizing text... ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  onProgress?.('Recognizing text from image...');
  const { data: { text } } = await worker.recognize(file);
  await worker.terminate();

  onProgress?.('Parsing prayer times...');
  return parseExtractedText(text);
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function parseTimetable(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<ParsedDay[]> {
  if (file.type === 'application/pdf') {
    return parsePDF(file, onProgress);
  }
  return parseImage(file, onProgress);
}
