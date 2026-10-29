# Task 2 Report: 描边胶囊 DOM 与折叠态 `wide` 接线

## What I implemented

- Reworked `BotMarketLauncher` in `client/client.js` into a `button.wbx-launcher` with:
  - `data-wide="true"` unless `props.wide === false`, in which case `data-wide="false"`.
  - `title` and the visible label both using the existing `t('nav')` locale key.
  - Three stable children: `.wbx-launcher-icon`, `.wbx-launcher-label`, `.wbx-launcher-caret`.
  - Icon and caret spans marked `aria-hidden: true`.
- Added `BotMarketLauncherIcon`: an inline 16x16 SVG sparkle built with `el('svg', ...)` and three `el('path', ...)` children.
- Added `BotMarketLauncherCaret`: an inline 12x12 SVG disclosure caret built with `el('svg', ...)` and `el('path', ...)`.
- Updated the `sidebar.footer.action` registration callback to accept `ownerProps` and forward
  `ownerProps.wide` (with null-safe access) to `BotMarketLauncher`.
- Added the brief's `the sidebar launcher exposes the wide flag to CSS and keeps a stable label`
  test to `test/client-surface.test.js`. It covers `wide: true`, `wide: false`, and omitted `wide`
  (expanded), plus the three-child order, localized label, and caret accessibility marker.

The implementation follows the brief's supplied code verbatim (apart from preserving the file's CRLF
line endings). No CSS, locale keys, dependencies, build steps, version numbers, storage access,
observers, or host DOM injection were added or changed.

## TDD Evidence

### RED 1: existing launcher contract

Command:

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-bot-ui.test.js
```

Result: 6 passed, 1 failed. The relevant failure was:

```text
✖ the Bot launcher renders a bordered pill with an icon, label and caret
AssertionError [ERR_ASSERTION]: The input did not match the regular expression
/'data-wide': props\.wide === false \? 'false' : 'true'/
```

The extracted `BotMarketLauncher` block still rendered the old single text child and had no
`data-wide` attribute. This is the expected missing-feature failure, not a test or setup error.

### RED 2: new surface behavior test

After adding the Step 1 test, command:

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-surface.test.js
```

Result: 11 passed, 1 failed:

```text
✖ the sidebar launcher exposes the wide flag to CSS and keeps a stable label
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ undefined
- 'true'
```

This is expected because the pre-implementation launcher had no `data-wide` prop.

### GREEN: focused verification after implementation

Command:

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-bot-ui.test.js test/client-surface.test.js
```

Result:

```text
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
```

All 7 `client-bot-ui` tests and all 12 `client-surface` tests pass with pristine output (no warnings
or stderr failures). The same focused command was rerun after the commit and again passed 19/19.

## Files changed

- `client/client.js` (three-child launcher DOM, inline SVG icon/caret helpers, `wide` forwarding)
- `test/client-surface.test.js` (the specified wide/label contract test)

Commit:

```text
7f73e63 feat: render the Bot launcher as an icon-label pill
```

Only those two files are in the commit. `git status --short` shows only untracked
`.superpowers/` scratch data after the commit.

## Self-review findings

- Every asserted child and attribute is present: class `wbx-launcher`, `data-wide`, icon, label,
  caret class names, localized `nav` label, and caret `aria-hidden`.
- `wide` is forwarded from the slot owner props. Omitted/undefined `wide` renders `"true"`; only
  strict `wide === false` renders `"false"`.
- Icons are inline SVGs created exclusively with `el(...)`; no dependency or build change was made.
- No CSS rule or locale key was added or changed; the existing Task 3 CSS remains untouched.
- `test/client-bot-ui.test.js`, `package.json`, and all other tracked files were not modified.
- `node --check client/client.js` passes, `git diff --check` reports no whitespace errors, and the
  final focused test run is clean.
- The task context mentions 17 existing surface tests, but the checked-in file has 11 tests before
  the new test and 12 after. There is no failing or skipped test; this appears to be only a stale
  count in the task context.

## Concerns

None blocking. The only note is the surface-test-count discrepancy mentioned above.
