## 2025-05-18 - Unencoded ASCII Control Characters in External URL Gate

**Vulnerability:** URLs containing embedded unencoded ASCII control characters (such as `\t`, `\r`, `\n`, `\0`) parsed successfully in WHATWG `new URL()` but returned raw control characters when passed verbatim to `shell.openExternal`.
**Learning:** WHATWG URL parser silently strips or ignores certain control characters and tabs/newlines in URL strings during parsing, but returning the raw input string handed `shell.openExternal` unsanitized control characters that could cause command-line argument splitting or URL handler bypasses on host OSes.
**Prevention:** In URL validation gates, explicitly check for and reject raw ASCII control characters (`/[\x00-\x1f\x7f]/`) after trimming before passing URLs to system shells.
