from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

URL = "https://masjidbox.com/prayer-times/surrey-islamic-society"
PRAYERS = ["Fajr", "Shuruq", "Dhuhr", "Asr", "Maghrib", "Isha", "Jumuah"]

def collect_digits(lines, start):
    """Concatenate consecutive digit-only lines starting at index."""
    result = ""
    i = start
    while i < len(lines) and lines[i].isdigit():
        result += lines[i]
        i += 1
    return result, i

def parse_time(raw):
    if len(raw) == 3:
        return f"{raw[0]}:{raw[1:]}"
    elif len(raw) == 4:
        return f"{raw[:2]}:{raw[2:]}"
    return raw

def scrape():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(URL, wait_until="networkidle", timeout=60000)
        soup = BeautifulSoup(page.content(), "html.parser")
        browser.close()

    lines = [l.strip() for l in soup.get_text(separator="\n").splitlines() if l.strip()]

    results = {}
    i = 0
    while i < len(lines):
        if lines[i] in PRAYERS:
            prayer = lines[i]
            i += 1
            adhan_raw, i = collect_digits(lines, i)
            iqamah_raw = None
            if i < len(lines) and lines[i] == "Iqamah":
                i += 1
                iqamah_raw, i = collect_digits(lines, i)
            results[prayer] = {
                "adhan": parse_time(adhan_raw),
                "iqamah": parse_time(iqamah_raw) if iqamah_raw else None,
            }
        else:
            i += 1

    return results

if __name__ == "__main__":
    data = scrape()
    for prayer, times in data.items():
        iqamah_str = f"  Iqamah: {times['iqamah']}" if times["iqamah"] else ""
        print(f"{prayer}: {times['adhan']}{iqamah_str}")
