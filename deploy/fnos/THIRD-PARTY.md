# Runtime dependencies and reuse

- Node.js 24 (MIT and bundled third party notices): https://github.com/nodejs/node
- Debian bookworm packages and their installed `/usr/share/doc/*/copyright` notices are retained in the image.
- Playwright/Chromium: lockfile currently resolves Playwright 1.61.0 (Apache-2.0); install its own matching Chromium, rather than an unrelated system Chrome. https://github.com/microsoft/playwright
- noVNC (MPL-2.0) and websockify (LGPL-3.0): Debian maintained packages. https://github.com/novnc/noVNC and https://github.com/novnc/websockify
- Xvfb/Xorg (MIT), x11vnc (GPL-2.0), tini (MIT); installed via Debian packages with original notices.
- ImageMagick (ImageMagick license), build-time resizing of existing project icon only: https://imagemagick.org/script/license.php
- fnpack 1.2.1 is the official proprietary fnOS build tool, downloaded from https://static2.fnnas.com/fnpack/ and SHA256 pinned in CI. It is not redistributed inside the runtime image.

Package layout follows the official Docker application example https://developer.fnnas.com/docs/examples/docker/ (read through the source-preserving mirror https://github.com/ckcoding/fnnas-docs/blob/main/docs/examples/docker.md when the official server was inaccessible). No third party application implementation is copied.

The project lockfile supplies existing application dependencies and their license notices. The image includes npm's installed package license files. No Electron process is started; service entrypoint is `node windows/workbench/nas/main.mjs`. This package does not redistribute or mount any ERP application or data.
