## 2025-05-18 - Avoid Array Sorts and String Slice Iterations in Hot Lookup Paths

**Learning:** In hot path functions like font metrics lookups, `[...candidates].sort()` creates unnecessary array copies and $O(N \log N)$ sorting overhead when only the top element (max score) is needed. Furthermore, `for (const ch of text)` string iteration allocates a new string slice for every code point.
**Action:** Use an $O(N)$ linear scan (`bestStyleMatch`) to select the top candidate without array allocations, and iterate strings with `codePointAt(i)` advancing by `cp > 0xffff ? 2 : 1` to eliminate GC allocation overhead.
