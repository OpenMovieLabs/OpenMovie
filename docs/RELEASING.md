# Releasing

## Release inputs

Tag releases require all of the following GitHub Actions secrets:

- macOS: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`;
- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`.

The tag must be a verified signed tag named `v<semver>`. Manual workflow dispatches can create
unsigned development artifacts; they are never published as a stable GitHub Release.

## Procedure

1. Ensure `main` is clean and CI is green on Windows and macOS.
2. Run `pnpm check`, `pnpm build`, `pnpm smoke:desktop`, and the enforced performance baseline.
3. Update release notes and choose the SemVer change.
4. Create and push a signed annotated tag.
5. Confirm both platform package jobs, signing, notarization, Sidecar checks and artifact upload.
6. Confirm the publish job verifies the tag and attaches installers, update metadata, Blockmaps,
   CycloneDX SBOM and `SHA256SUMS.txt`.
7. Install the published build on clean Windows and macOS machines, create a project, run the Fake
   path, render a cut, check updates and inspect signature/notarization status.

Before artifact upload, each platform job launches its packaged executable with the self-closing
integration smoke. Packaged mode must report the media runtime as `bundled`; a missing or damaged
FFmpeg/FFprobe pair fails the release.

macOS builds compile pinned FFmpeg source with LGPL configuration and reject `--enable-gpl`.
Windows downloads a pinned BtbN LGPL archive and verifies SHA-256. Both builds confirm the MPEG-4
fallback encoder before packaging. The repository stays 0BSD; Sidecars remain separately licensed
LGPL executables with bundled notices.

Never publish by weakening the signing gate, replacing a pinned checksum without reviewing the
source, or uploading locally built binaries over CI assets.
