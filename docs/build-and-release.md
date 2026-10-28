# Build and Release

## Requirements

- Node.js >= 20
- The fixed `workbuddyskills` snapshot under
  `packages/dsh-workbuddy-expert-plus/vendor-input/workbuddyskills/experts`
- npm (the pack checker invokes the Node-installed npm CLI)

## Commands

```bash
cd packages/dsh-workbuddy-expert-plus
npm run build:experts       # regenerate resources/experts + build/reports
npm test                    # node:test suites + all legacy smoke scripts
npm run check:package       # npm pack, unpack, hash-check and offline-load
```

Artifacts:

```text
resources/experts/manifest.json
resources/experts/catalog.sha256
resources/experts/<expert-id>/expert.json
resources/experts/<expert-id>/role.md
resources/experts/<expert-id>/avatar.*         # when present
resources/experts/<expert-id>/skills/...       # license-cleared, inert
build/reports/*.json
build/dsh-workbuddy-expert-plus-0.1.1.tgz
```

## Packaging guarantees checked automatically

1. `resources/experts/manifest.json` appears in the npm pack file list.
2. Every manifest expert's declared files exist and hash-match after unpacking.
3. `vendor-input/` and `build/` never enter the tarball.
4. The catalog loads from the unpacked package, with no WorkBuddy directory and
   no vendor input present.
5. The client bundle and all server modules are included.

## Known release blockers

- **Resource authorization:** 390 of 429 indexed experts lack prompt-level
  redistribution evidence; do not advertise a full 429-expert bundle.
- **Physical host smoke tests:** E01–E07/E10/E14/E15/E16 require a real DSH
  Desktop/Web and DS-Bot standalone installation; they are not replaced by unit tests.
