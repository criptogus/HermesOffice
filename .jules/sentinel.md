## 2025-05-18 - Unencoded ASCII Control Characters in External URL Gate

**Vulnerability:** URLs containing embedded unencoded ASCII control characters (such as `\t`, `\r`, `\n`, `\0`) parsed successfully in WHATWG `new URL()` but returned raw control characters when passed verbatim to `shell.openExternal`.
**Learning:** WHATWG URL parser silently strips or ignores certain control characters and tabs/newlines in URL strings during parsing, but returning the raw input string handed `shell.openExternal` unsanitized control characters that could cause command-line argument splitting or URL handler bypasses on host OSes.
**Prevention:** In URL validation gates, explicitly check for and reject raw ASCII control characters (`/[\x00-\x1f\x7f]/`) after trimming before passing URLs to system shells.

## 2025-05-20 - Windows Reserved Device Names and Trailing Characters in File Name Sanitizer

**Vulnerability:** User/AI-controlled document titles or attachment file names containing Windows reserved device names (such as `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9` with or without extensions) or trailing dots/spaces bypassed filename character-stripping checks and caused denial of service, hung processes, or unexpected filesystem errors when saved to disk on Windows.
**Learning:** Character-stripping regexes (`[/\\:*?"<>|\u0000-\u001f]`) only remove illegal glyphs; Windows interprets DOS-legacy device names regardless of file extension, and strips trailing dots/spaces which can lead to unexpected path resolution or filesystem hangs during `fs.writeFile` / `atomicWriteFile`.
**Prevention:** In filename sanitization gates (`sanitizeFileName`), explicitly strip trailing dots/spaces and prepend an underscore to any filename matching Windows reserved device names (`/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i`).
