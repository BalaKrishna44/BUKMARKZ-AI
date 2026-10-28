# Bukmarkz brand assets

    npm install
    npm run build:assets                 # writes ./public/assets
    npm run build:assets:ext             # same, and copies icon-16/32/48/128.png into ../extension/icons

Options: `node generate-assets.js --out <dir> --extension-dir <dir>`

Edit the logo in `logoSvg()` (colours in `BRAND`), then rebuild. Everything else is derived from it.

| Output | Use |
|---|---|
| `logo.svg`, `logo-mark.svg`, `logo-mono.svg` | master vectors: full colour tile, glyph only, one colour |
| `icons/icon-16/32/48/128/512.png` | Chrome extension and general app icons (16 and 32 use a simplified glyph so they stay readable) |
| `icons/icon-192.png`, `icon-maskable-512.png` | web app manifest (maskable has safe-zone padding) |
| `favicon/favicon.ico` (16, 32, 48), `favicon.svg`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` | website head tags |
| `social/og-image.png` (1200x630), `twitter-card.png` (1200x600) | link previews |

Head tags:

    <link rel="icon" href="/assets/favicon/favicon.ico" sizes="48x48">
    <link rel="icon" href="/assets/favicon/favicon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="/assets/favicon/apple-touch-icon.png">
    <meta property="og:image" content="https://www.bukmarkz.com/assets/social/og-image.png">
    <meta name="twitter:card" content="summary_large_image">

The social images contain text. The script asks for Inter, then Helvetica/Arial. Install Inter on the machine that runs the build so the output is identical everywhere.
