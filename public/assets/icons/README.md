# UI Icons

`lucide.svg` is generated from `lucide-static` 1.61.0 (ISC license).
The original license is included in `lucide-LICENSE`.

Source: https://lucide.dev/

Run `npm install` then `npm run icons` to regenerate the icon subset.
The generated sprite is committed with the application so production can use
`npm ci --omit=dev` without fetching icon assets from a CDN.

The shared `ui.js` replaces `data-icon` placeholders with decorative SVGs.
Accessible names belong on the containing button or link.
