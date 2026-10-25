## 2026-10-25 - Memoizing font coverage lookup queries
**Learning:** `findFontCovering(text)` scans all installed font files and parses sfnt `cmap` tables synchronously on disk. When called repeatedly during layout or re-renders, this can take 10ms - 60ms+ per lookup.
**Action:** Always memoize `findFontCovering` queries with a bounded Map cache. Caching identical queries reduces lookup time from ~60ms to <0.01ms.
