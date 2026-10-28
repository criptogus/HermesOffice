# HermesOffice identity

The Home screen's rounded H and two messenger dots are the canonical app mark.
Use black and white for the app identity. The default tile has a white background
and black strokes; the Home lockup follows its existing theme inversion for
contrast. Preserve the original proportions and rounded stroke ends.

The master vector is `apps/shell/build/icon.svg`. Regenerate the shared React
component, Home lockup, renderer PNGs, standalone Docs assets and OS icons with:

```sh
node tools/gen-app-icons.mjs
```

Generation uses installed Chrome. Run it on macOS to update the committed ICNS
files as well as PNG and ICO. The macOS icon has the standard 824/1024 optical
margin; Windows and Linux use the full canvas. Commit generated assets together
with the master. Editor badges use the shared `HermesMark` from
`@hermesoffice/ui`, preserving their context-specific display sizes.

The format tiles use their document-type colors. Their association assets are
generated separately with `tools/gen-file-association-icons.mjs`.
