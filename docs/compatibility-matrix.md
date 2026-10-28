# Compatibility Matrix

## Locked upstream revisions

| Repository | Commit | Version | Use |
|---|---|---|---|
| `pbwheel/dsh-workbuddy-expert` | `dd31d79a818125e045f349e0b0cf0b35408f9c9c` | 0.2.2 | Baseline source, MIT |
| `infometa/workbuddyskills` | `7ea565af29f6bede2acc0d7b55daa300db5de3f8` | 2026-10-27 sync | Build-time expert input |
| `Fei2411/DS-Bot` | `4a7b55069ad300eae8be42a74f31bc170b40ead7` | ds-bot 0.2.3 / app 0.2.2 | Bot protocol and slot contracts |

## DS-Bot contracts verified from source

| Contract | Verified value | Plugin handling |
|---|---|---|
| API | `POST api/bot` with `{endpoint,payload}` | Single adapter `src/adapters/dsbot-api.js` |
| State | `endpoint: state` → `bots`, `models`, `defaultModel`, `readOnly` | Normalized, malformed shape = incompatible |
| Create | `endpoint: create-bot`, fields `name,role,instructions,avatar,model,effort,workDir` | Only documented fields sent |
| Name | trim + max 40; no `@`, backtick or line breaks | Client and server validate |
| Role | trim + max 24 | Client and server validate |
| Avatar | data URL, max `160000` bytes | Not auto-generated; optional/omitted |
| Read-only | refusal code `bot/read-only`; state carries `readOnly` | Creation disabled, no install fallback |
| Surface | `localStorage['ds-bot:surface']`, missing key defaults to **bot** | Hint only; capability probe is authoritative |
| Sidebar slot | `sidebar.footer.action` | Unique id `workbuddy-expert-plus-market` |
| Overlay slot | `shell.overlay` | Unique id `workbuddy-expert-plus-market-overlay` |
| Priority helper | DS-Bot uses `freePriority`, Bot priority `-100` | Own ids/orders; no host shadowing |

## Environment matrix

| ID | Host combination | Status in this repo |
|---|---|---|
| E01 | Pure DSH Desktop, offline, no WorkBuddy | Automated offline catalog + install tests pass; **desktop UI not physically smoke-tested here** |
| E02 | Pure DSH Web, offline | Host routes and client bundle tested under stubs; **real Web host not run here** |
| E03 | DSH + DS-Bot plugin, Agent mode | Agent code path and original selector smoke pass; **live host not run** |
| E04 | DSH + DS-Bot plugin, Bot mode | Bot adapter/service/routes/UI bundle tests pass; **live Bot UI not run** |
| E05 | DSH Web + DS-Bot Bot mode | Same as E04; **not run live** |
| E06 | DS-Bot standalone App, Bot mode | **Not verifiable here** (app binary/runtime absent) |
| E07 | DS-Bot standalone App, Agent mode | **Not verifiable here** |
| E08 | Residual `ds-bot:surface=bot`, DS-Bot absent | State-machine test passes |
| E09 | DS-Bot read-only | Adapter/service/route tests pass |
| E10 | Two windows Agent/Bot | Conservative `unknown`/disabled logic implemented; **real multi-window not run** |
| E11 | Remove `vendor-input/` and WorkBuddy home | `check:package` reads the unpacked tgz only; vendor input excluded |
| E12 | Existing hand-written expert / duplicate Bot | Install-overwrite refusal and duplicate-name tests pass |
| E13 | Delete Bot then reopen | Binding pruning by live bot-id test passes |
| E14 | Uninstall plugin | Client disposer/lifecycle test passes; **real host unload not run** |
| E15 | Migrate legacy exports | Ownership manifest reader recognises legacy `sourcePath/pluginDir/agentFile/fingerprint` fields; **migration UI not run** |
| E16 | Old and new plugin enabled together | New id/namespace/slot ids avoid collisions; **simultaneous live enable not run** |

## Verdict

- **Automated, reproducible:** catalog integrity, prompt hashing, install and
  ownership safety, surface/capability state machine, DS-Bot request shapes,
  single-flight creation, complete-prompt preservation, slot lifecycle, and
  `.tgz` contents.
- **Not yet evidenced:** E01–E07, E10, E14, E15 and E16 on physical host
  installations. These remain explicit release gates; this repo does not claim
  they passed.
- **License gate:** full 429-expert inclusion is blocked; 39 approved experts
  are shipped.
