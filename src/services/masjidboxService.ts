/**
 * Fetches today's prayer times from masjidbox.com.
 *
 * On native (iOS/Android) CapacitorHttp bypasses CORS.
 * On web the fetch may fail due to CORS — the caller should fall back
 * to Firestore monthly-schedule data in that case.
 *
 * Parsing logic ported from scrape_prayer_times.py.
 */
import { Capacitor } from '@capacitor/core';
import { CapacitorHttp } from '@capacitor/core';

const MASJIDBOX_URL =
  'https://masjidbox.com/prayer-times/surrey-islamic-society';

const PRAYER_KEYS = ['Fajr', 'Shuruq', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Jumuah'];

// ── Types ───────────────────────────────────────────────────────────────────

export interface LivePrayer {
  name: string;
  athan: string;
  iqama: string;
}

export interface TodayPrayerData {
  dateStr: string;
  hijriDate: string;
  sunrise: string;
  prayers: LivePrayer[];
}

// ── HTML → plain-text helpers (mirrors BeautifulSoup.get_text) ──────────────

function htmlToLines(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/?(div|p|li|tr|td|th|h[1-6]|section|header|footer|nav|article|aside|main|blockquote|span)[^>]*>/gi,
      '\n',
    )
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

// ── Digit-collection (same algorithm as scrape_prayer_times.py) ─────────────

function collectDigits(
  lines: string[],
  start: number,
): [string, number] {
  let result = '';
  let i = start;
  while (i < lines.length && /^\d+$/.test(lines[i])) {
    result += lines[i];
    i++;
  }
  return [result, i];
}

function parseTime(raw: string): string {
  if (raw.length === 3) return `${raw[0]}:${raw.slice(1)}`;
  if (raw.length === 4) return `${raw.slice(0, 2)}:${raw.slice(2)}`;
  return raw;
}

// ── Extract Hijri date from page text ───────────────────────────────────────

function extractHijriDate(lines: string[]): string {
  const full = lines.join(' ');
  // Matches patterns like "(29 Shawwal 1447)" or "29 Shawwal 1447"
  const match = full.match(
    /(\d{1,2})\s+(Muharram|Safar|Rabi[' ]?u?l?[- ]?Aw{1,2}al|Rabi[' ]?u?l?[- ]?Thani|Jumada[' ]?[- ]?(?:al[- ]?)?(?:Ula|Akhirah|I|II)|Rajab|Sha'?ban|Ramad[ah]an|Shaww?al|Dhu[' ]?l[- ]?Qa'?dah?|Dhu[' ]?l[- ]?Hijjah?)\s+(\d{4})/i,
  );
  return match ? `${match[1]} ${match[2]} ${match[3]}` : '';
}

// ── Main fetch + parse ──────────────────────────────────────────────────────

export async function fetchTodayPrayers(): Promise<TodayPrayerData | null> {
  try {
    let html: string;

    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.get({ url: MASJIDBOX_URL });
      html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    } else {
      const response = await fetch(MASJIDBOX_URL);
      html = await response.text();
    }

    const lines = htmlToLines(html);

    // --- Parse prayer times (direct port of Python script) ---
    const raw: Record<string, { adhan: string; iqamah: string | null }> = {};

    let i = 0;
    while (i < lines.length) {
      if (PRAYER_KEYS.includes(lines[i])) {
        const key = lines[i];
        i++;
        const [adhanRaw, next1] = collectDigits(lines, i);
        i = next1;
        let iqamahRaw: string | null = null;
        if (i < lines.length && lines[i] === 'Iqamah') {
          i++;
          const [iqRaw, next2] = collectDigits(lines, i);
          iqamahRaw = iqRaw;
          i = next2;
        }
        if (adhanRaw) {
          raw[key] = {
            adhan: parseTime(adhanRaw),
            iqamah: iqamahRaw ? parseTime(iqamahRaw) : null,
          };
        }
      } else {
        i++;
      }
    }

    // --- Build structured output ---
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const prayers: LivePrayer[] = [];

    const addPrayer = (displayName: string, key: string) => {
      const entry = raw[key];
      if (entry) {
        prayers.push({
          name: displayName,
          athan: entry.adhan,
          iqama: entry.iqamah ?? entry.adhan,
        });
      }
    };

    addPrayer('Fajr', 'Fajr');
    // On Fridays the page shows "Jumuah" instead of "Dhuhr"
    addPrayer('Dhuhr', raw['Jumuah'] ? 'Jumuah' : 'Dhuhr');
    addPrayer('Asr', 'Asr');
    addPrayer('Maghrib', 'Maghrib');
    addPrayer('Isha', 'Isha');

    if (prayers.length === 0) return null;

    return {
      dateStr,
      hijriDate: extractHijriDate(lines),
      sunrise: raw['Shuruq']?.adhan ?? '',
      prayers,
    };
  } catch (error) {
    console.error('masjidbox fetch failed:', error);
    return null;
  }
}
