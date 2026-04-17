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

const MONTH_ABBREVS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/**
 * Detect month + year from text.  Tries several strategies to handle
 * OCR artefacts (extra spaces, partial words, garbled characters).
 */
function detectMonthYear(text: string): { month: number; year: number } | null {
  const lower = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');

  // Strategy 1 — full month name + 4-digit year
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const m = lower.match(new RegExp(`${MONTH_NAMES[i]}\\s+(\\d{4})`));
    if (m) return { month: i, year: parseInt(m[1]) };
  }

  // Strategy 2 — 3-letter abbreviation + year
  for (let i = 0; i < MONTH_ABBREVS.length; i++) {
    const m = lower.match(new RegExp(`\\b${MONTH_ABBREVS[i]}\\w*\\s+(\\d{4})`));
    if (m) return { month: i, year: parseInt(m[1]) };
  }

  // Strategy 3 — find any year 20XX then any month reference anywhere
  const yearMatch = text.match(/\b(20[2-3]\d)\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    for (let i = 0; i < MONTH_ABBREVS.length; i++) {
      if (lower.includes(MONTH_ABBREVS[i])) return { month: i, year };
    }
    return { month: new Date().getMonth(), year };
  }

  return null;
}

/**
 * Pull every HH:MM (24-hour) token from a string.
 * Handles `:` and `.` separators, and colonless 3-4 digit sequences.
 */
function extractTimes(text: string): string[] {
  const times: string[] = [];

  // Pass 1 — standard H:MM or HH:MM (also `.` separator from OCR)
  const regex1 = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
  let m: RegExpExecArray | null;
  while ((m = regex1.exec(text)) !== null) {
    times.push(`${m[1].padStart(2, '0')}:${m[2]}`);
  }

  if (times.length > 0) return times;

  // Pass 2 — 3 or 4 digit sequences that look like times without a separator
  const regex2 = /\b([01]?\d|2[0-3])([0-5]\d)\b/g;
  while ((m = regex2.exec(text)) !== null) {
    const h = parseInt(m[1]);
    if (h <= 23) times.push(`${m[1].padStart(2, '0')}:${m[2]}`);
  }

  return times;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Map an array of extracted time strings to a structured ParsedDay. */
function buildDay(dateStr: string, times: string[]): ParsedDay {
  const prayers: Prayer[] = [];
  let sunrise: string | undefined;

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
  } else if (times.length >= 8) {
    prayers.push({ name: 'Fajr', athan: times[0], iqama: times[1] });
    sunrise = times[2];
    prayers.push({ name: 'Dhuhr', athan: times[3], iqama: times[4] });
    prayers.push({ name: 'Asr', athan: times[5], iqama: times[6] });
    prayers.push({ name: 'Maghrib', athan: times[7], iqama: times[7] });
  } else if (times.length >= 5) {
    prayers.push({ name: 'Fajr', athan: times[0], iqama: times[1] });
    sunrise = times[2];
    prayers.push({ name: 'Dhuhr', athan: times[3], iqama: times[4] });
    if (times.length >= 7) prayers.push({ name: 'Asr', athan: times[5], iqama: times[6] });
  } else {
    prayers.push({ name: 'Fajr', athan: times[0], iqama: times.length > 1 ? times[1] : times[0] });
    if (times.length > 2) sunrise = times[2];
    if (times.length > 4) prayers.push({ name: 'Dhuhr', athan: times[3], iqama: times[4] });
  }

  return { dateStr, sunrise, prayers };
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

    // Day number: digits followed by whitespace (not colon → that's a time)
    const dayMatch = line.match(/^(\d{1,2})\s/);
    const dayNum = dayMatch ? parseInt(dayMatch[1]) : 0;

    if (dayNum >= 1 && dayNum <= maxDay) {
      merged.push(line);
    } else if (merged.length > 0 && extractTimes(line).length > 0) {
      // Continuation line with times — merge into previous day-row
      merged[merged.length - 1] += ' ' + line;
    } else {
      merged.push(line);
    }
  }
  return merged;
}

// ── Core text→data parser (3-pass) ─────────────────────────────────────────

/**
 * Parse raw text (from OCR or PDF extraction) into structured prayer-day data.
 *
 * Uses three progressively more lenient strategies:
 *   Pass 1 — strict line-by-line (requires ≥5 times per merged row)
 *   Pass 2 — segment-based (groups ALL lines between day-number anchors)
 *   Pass 3 — bulk template (divides ALL extracted times into fixed-size chunks)
 */
export function parseExtractedText(text: string): ParsedDay[] {
  console.log('──── Extracted text (first 2000 chars) ────');
  console.log(text.substring(0, 2000));
  console.log('──── end text ────');

  const monthYear = detectMonthYear(text);
  console.log('Detected month/year:', monthYear);

  if (!monthYear) {
    const sample = text.substring(0, 300).replace(/\n/g, ' ');
    throw new Error(
      'Could not detect the month and year from the timetable.\n\n' +
      'Text saw: "' + sample + '..."\n\n' +
      'Make sure the timetable header includes text like "April 2025".',
    );
  }

  const { month, year } = monthYear;
  const maxDay = daysInMonth(year, month);
  const halfMonth = Math.ceil(maxDay * 0.5);

  // ── Pass 1: line-by-line with row merging (most accurate when text is clean) ──
  const mergedLines = mergeRows(text.split('\n'), maxDay);
  let days: ParsedDay[] = [];
  const seen = new Set<number>();

  for (const line of mergedLines) {
    const dayMatch = line.match(/^(\d{1,2})\b/);
    if (!dayMatch) continue;

    const dayNum = parseInt(dayMatch[1]);
    if (dayNum < 1 || dayNum > maxDay || seen.has(dayNum)) continue;

    const times = extractTimes(line);
    if (times.length < 5) continue;

    seen.add(dayNum);
    const dateStr =
      `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    days.push(buildDay(dateStr, times));
  }

  console.log(`Pass 1 (line-by-line): ${days.length}/${maxDay} days`);

  // ── Pass 2: segment-based (collect everything between day-number anchors) ──
  if (days.length < halfMonth) {
    console.log('Pass 1 insufficient — trying segment-based parse...');

    const allLines = text.split('\n');
    const segments: { dayNum: number; parts: string[] }[] = [];
    const seen2 = new Set<number>();

    for (const rawLine of allLines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Day number: 1-2 digits followed by whitespace, NOT followed by colon
      const dayMatch = line.match(/^\s*\|?\s*(\d{1,2})(?:\s|$)/);
      const dayNum = dayMatch ? parseInt(dayMatch[1]) : 0;
      const startsWithTime = /^\s*\d{1,2}[:.]/.test(line);

      if (dayNum >= 1 && dayNum <= maxDay && !seen2.has(dayNum) && !startsWithTime) {
        seen2.add(dayNum);
        segments.push({ dayNum, parts: [line] });
      } else if (segments.length > 0) {
        // Merge everything into the current day's segment
        segments[segments.length - 1].parts.push(line);
      }
    }

    const pass2: ParsedDay[] = [];
    for (const seg of segments) {
      const times = extractTimes(seg.parts.join(' '));
      if (times.length >= 2) {
        const dateStr =
          `${year}-${String(month + 1).padStart(2, '0')}-${String(seg.dayNum).padStart(2, '0')}`;
        pass2.push(buildDay(dateStr, times));
      }
    }

    console.log(`Pass 2 (segment): ${pass2.length} days`);
    if (pass2.length > days.length) days = pass2;
  }

  // ── Pass 3: bulk template (divide ALL times into fixed-size chunks) ──
  if (days.length < halfMonth) {
    console.log('Pass 2 insufficient — trying bulk template parse...');

    const allTimes = extractTimes(text);
    console.log(`Total times in text: ${allTimes.length}`);

    // Try common column counts (11 = standard, 10/12/13 = variants)
    const colCandidates = [11, 10, 12, 13];
    let bestResult: ParsedDay[] = [];

    for (const cols of colCandidates) {
      // Try skipping 0..cols header times
      const maxOffset = Math.min(cols, Math.max(0, allTimes.length - halfMonth * cols));
      for (let offset = 0; offset <= maxOffset; offset++) {
        const remaining = allTimes.slice(offset);
        const rowCount = Math.min(Math.floor(remaining.length / cols), maxDay);
        if (rowCount < halfMonth) continue;

        const attempt: ParsedDay[] = [];
        for (let day = 1; day <= rowCount; day++) {
          const chunk = remaining.slice((day - 1) * cols, day * cols);
          const dateStr =
            `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const parsed = buildDay(dateStr, chunk);
          if (parsed.prayers.length > 0) attempt.push(parsed);
        }

        if (attempt.length > bestResult.length) bestResult = attempt;
      }
    }

    console.log(`Pass 3 (template): ${bestResult.length} days`);
    if (bestResult.length > days.length) days = bestResult;
  }

  days.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

  console.log(`Final result: ${days.length} days parsed`);
  if (days.length > 0) console.log('Sample day 1:', JSON.stringify(days[0]));

  if (days.length === 0) {
    const sampleLines = text.split('\n').filter(l => l.trim()).slice(0, 10).join('\n');
    throw new Error(
      'No prayer times could be extracted.\n\n' +
      'Text read:\n' + sampleLines + '\n\n' +
      'This may mean the image quality is too low for text recognition. ' +
      'Try uploading a PDF with selectable text instead, or a higher-resolution photo.',
    );
  }

  return days;
}

// ── PDF extraction (tolerance-based Y-clustering) ──────────────────────────

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

    // Collect all text items with their (x, y) positions
    const items: Array<{ x: number; y: number; text: string }> = [];
    for (const item of content.items) {
      const t = item as { str: string; transform: number[] };
      if (!t.str?.trim()) continue;
      items.push({ x: t.transform[4], y: t.transform[5], text: t.str });
    }

    // Sort items top→bottom (PDF Y is bottom-up, so descending = visual top-first)
    items.sort((a, b) => b.y - a.y);

    // Cluster into rows using Y-tolerance (cells in same visual row can differ
    // by a few points due to baseline alignment or font variation)
    const Y_TOLERANCE = 5;
    const rows: Array<{ refY: number; cells: Array<{ x: number; text: string }> }> = [];

    for (const item of items) {
      let placed = false;
      for (const row of rows) {
        if (Math.abs(item.y - row.refY) <= Y_TOLERANCE) {
          row.cells.push({ x: item.x, text: item.text });
          placed = true;
          break;
        }
      }
      if (!placed) {
        rows.push({ refY: item.y, cells: [{ x: item.x, text: item.text }] });
      }
    }

    // Sort rows top→bottom, cells left→right
    rows.sort((a, b) => b.refY - a.refY);
    for (const row of rows) {
      row.cells.sort((a, b) => a.x - b.x);
      // Join cells and normalize fragmented times ("4 : 33" → "4:33")
      let rowText = row.cells.map(c => c.text).join(' ');
      rowText = rowText.replace(/(\d)\s*:\s*(\d)/g, '$1:$2');
      rowText = rowText.replace(/(\d)\s*\.\s*(\d)/g, '$1.$2');
      fullText += rowText + '\n';
    }
  }

  // If the PDF has selectable text, parse it directly
  const hasText = fullText.trim().length > 50 && extractTimes(fullText).length > 5;
  if (hasText) {
    onProgress?.('Parsing prayer times...');
    return parseExtractedText(fullText);
  }

  // ── Fallback: scanned/image-based PDF → render to canvas → OCR ──
  console.log('PDF has no selectable text — falling back to OCR');
  onProgress?.('PDF is a scanned image, running text recognition...');

  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress?: number }) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(`Recognizing text... ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  let ocrText = '';
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.(`OCR page ${pageNum}/${pdf.numPages}...`);
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.5 }); // high-res for better OCR
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas to blob failed'))), 'image/png'),
    );

    const { data: { text: pageText } } = await worker.recognize(blob);
    ocrText += pageText + '\n';
  }

  await worker.terminate();

  onProgress?.('Parsing prayer times...');
  return parseExtractedText(ocrText);
}

// ── Generate a thumbnail from the first page of a PDF ──────────────────────

export async function generatePdfThumbnail(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 0.5 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.5);
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
