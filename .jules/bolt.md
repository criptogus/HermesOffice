## 2026-10-25 - Memoizing font coverage lookup queries

**Learning:** `findFontCovering(text)` scans all installed font files and parses sfnt `cmap` tables synchronously on disk. When called repeatedly during layout or re-renders, this can take 10ms - 60ms+ per lookup.
**Action:** Always memoize `findFontCovering` queries with a bounded Map cache. Caching identical queries reduces lookup time from ~60ms to <0.01ms.

## 2026-10-28 - Binary search vs linear scan in sfnt cmap table subtables

**Learning:** sfnt format 4 segments and format 12 groups are sorted ascending by character code in compliant TrueType/OpenType fonts. Linear scans over subtables with up to 30,000 CJK groups take milliseconds per font scan on misses, whereas binary search ($O(\log N)$) resolves coverage checks in ~0.01ms.
**Action:** Always use binary search when probing format 4 (`endCode`) and format 12 (`startCharCode`) `cmap` subtables instead of linear loops.
