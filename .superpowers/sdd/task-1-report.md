# Task 1 Report: 用失败测试锁定方案 B 的入口契约

## What I implemented

Appended exactly one source-contract test to `test/client-bot-ui.test.js`:

`the Bot launcher renders a bordered pill with an icon, label and caret`

The test uses the file's existing top-level `source` constant and existing
`node:test` / `node:assert/strict` imports. It locks the launcher class name,
`data-wide` expression, icon/label/caret class names, nav label, presentation-only
caret (`aria-hidden`), and absence of `useLayoutEffect` /
`getBoundingClientRect`. No production code or other file was modified.

## TDD Evidence

### RED

Command:

```bash
node --test test/client-bot-ui.test.js
```

Result: 7 tests, 6 pass, 1 fail (exit code 1).

Relevant output:

```text
✔ client has a Bot-mode market launcher and overlay
✔ Bot form reads the complete prompt and posts it unchanged
✔ read-only and unknown environments expose no create action
✔ marketCounts separates the bundled catalog from the local source
✔ ExpertCard accepts a Bot action and an optional created mark
✔ Bot market reuses the Agent card anatomy and category chips
✖ the Bot launcher renders a bordered pill with an icon, label and caret
ℹ tests 7
ℹ pass 6
ℹ fail 1

test at test\client-bot-ui.test.js:247:1
✖ the Bot launcher renders a bordered pill with an icon, label and caret
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression
  /'data-wide': props\.wide === false \? 'false' : 'true'/
```

Why this is the expected failure: the test loads successfully and executes its
assertions; it fails on the first absent DOM-contract marker (`data-wide`) because
the current `BotMarketLauncher` still renders only `className: 'wbx-launcher'`
with `t('nav')`. This is not a syntax, import, or test-harness error. The missing
`wbx-launcher-icon`, `-label`, and `-caret` markers are likewise absent pending
Task 2.

### GREEN (pre-existing tests)

Because this task intentionally commits a RED contract test while Task 2 owns the
DOM implementation, the full focused file is expected to retain 6 passing tests
and 1 intentionally failing new test at this commit point. I verified all six
pre-existing tests remain green:

Command:

```bash
node --test --test-name-pattern='^(client has a Bot-mode|Bot form reads|read-only and unknown|marketCounts separates|ExpertCard accepts|Bot market reuses)' test/client-bot-ui.test.js
```

Result: 6 tests, 6 pass, 0 fail (exit code 0).

```text
✔ client has a Bot-mode market launcher and overlay
✔ Bot form reads the complete prompt and posts it unchanged
✔ read-only and unknown environments expose no create action
✔ marketCounts separates the bundled catalog from the local source
✔ ExpertCard accepts a Bot action and an optional created mark
✔ Bot market reuses the Agent card anatomy and category chips
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

The CSS contract test was deliberately not added; per the plan it belongs in Task 3.

## Files changed

- `test/client-bot-ui.test.js` — appended 14 lines (one test).

Commit:

- `7c13ae3 test: lock the Bot launcher pill contract`

Only that file is in the commit. Working tree after commit contains only the
expected untracked `.superpowers/` scratch directory.

## Self-review findings

- [x] Added exactly one test, matching the brief's code verbatim.
- [x] Watched it fail for the expected reason (missing `data-wide` contract
      marker), not a typo, syntax error, or broken fixture.
- [x] Confirmed all six pre-existing tests in the file still pass.
- [x] Did not modify `client/client.js`, `package.json`, or any other tracked file.
- [x] No new dependency, build step, or version change.
- [x] Used existing top-level `source` and existing imports.
- [x] Commit message is exactly `test: lock the Bot launcher pill contract`.
- [x] Working tree is clean apart from expected `.superpowers/` scratch.
- [x] Did not add the deferred CSS contract test.

## Review follow-up: scope the contract to BotMarketLauncher

### Finding addressed

Reviewer identified an Important false-positive risk: `t('nav')`,
`'aria-hidden': true`, and several contract class names also occur elsewhere in
the large client bundle. File-wide assertions could therefore pass even if the
launcher itself lacked the required structure. Human approved the plan-mandated
fix.

### What changed

Replaced the existing launcher contract test with the reviewer-supplied scoped
version. It now extracts the `BotMarketLauncher` function block with:

```js
const launcher = source.match(/function BotMarketLauncher \(props\) \{[\s\S]*?\n\}/)
assert.ok(launcher, 'BotMarketLauncher is defined')
const block = launcher[0]
```

All launcher contract assertions now run against `block` rather than the entire
`source`. No production code or other test was changed.

Commit:

- `3177ee2 test: scope the Bot launcher contract to its component`

### RED evidence (scoped test)

Command:

```bash
node --test test/client-bot-ui.test.js
```

Result: 7 tests, 6 pass, 1 fail (exit code 1).

Relevant output:

```text
✔ client has a Bot-mode market launcher and overlay
✔ Bot form reads the complete prompt and posts it unchanged
✔ read-only and unknown environments expose no create action
✔ marketCounts separates the bundled catalog from the local source
✔ ExpertCard accepts a Bot action and an optional created mark
✔ Bot market reuses the Agent card anatomy and category chips
✖ the Bot launcher renders a bordered pill with an icon, label and caret
ℹ tests 7
ℹ pass 6
ℹ fail 1

test at test\client-bot-ui.test.js:247:1
✖ the Bot launcher renders a bordered pill with an icon, label and caret
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression
  /'data-wide': props\.wide === false \? 'false' : 'true'/. Input:

  'function BotMarketLauncher (props) {\r\n' +
    '  var t = props.t\r\n' +
    '  var store = props.surfaceStore\r\n' +
    "  var surfaceState = React.useState(store !== undefined && store !== null ? store.get() : 'unknown')\r\n" +
    ...
```

Why this is the expected failure: the extraction succeeded (`BotMarketLauncher`
was found), and the failure input is confirmed to be the launcher function block,
not the full bundle. The block currently lacks the required `data-wide`
attribute; the new `wbx-launcher-icon` / `-label` / `-caret` markers are likewise
pending Task 2. This verifies the assertions are genuinely scoped and exercises
the missing launcher contract rather than unrelated file-wide matches.

### GREEN evidence (pre-existing tests, post-scoping)

Command:

```bash
node --test --test-name-pattern='^(client has a Bot-mode|Bot form reads|read-only and unknown|marketCounts separates|ExpertCard accepts|Bot market reuses)' test/client-bot-ui.test.js
```

Result: 6 tests, 6 pass, 0 fail (exit code 0).

```text
✔ client has a Bot-mode market launcher and overlay
✔ Bot form reads the complete prompt and posts it unchanged
✔ read-only and unknown environments expose no create action
✔ marketCounts separates the bundled catalog from the local source
✔ ExpertCard accepts a Bot action and an optional created mark
✔ Bot market reuses the Agent card anatomy and category chips
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

### Files changed by follow-up

- `test/client-bot-ui.test.js` — launcher test scoped to its component (one test
  modified in place; no additional test).

Only that file is in the follow-up commit. The pre-existing modification to
`docs/superpowers/plans/2026-10-29-bot-sidebar-launcher-pill.md` was already in
the working tree and was not staged or changed by this task.

## Concerns

None. The focused test file is intentionally red at this checkpoint until Task 2
adds the launcher DOM contract; all pre-existing tests are green, and the
launcher contract is now scoped to `BotMarketLauncher` so unrelated bundle code
cannot satisfy it.

## Reviewer fix (human-approved scope change)

The original file-wide assertions were found too weak because `t('nav')` and `'aria-hidden': true` already exist elsewhere in the bundle. The test was re-scoped to extract the exact `function BotMarketLauncher (props) { ... }` block and assert every marker against that block only.

Commit: 3177ee2 test: scope the Bot launcher contract to its component

RED after scoping: `node --test test/client-bot-ui.test.js` -> 6 pass / 1 fail; failure input is the extracted `BotMarketLauncher` block, expected `/'data-wide': props\.wide === false \? 'false' : 'true'/`.
