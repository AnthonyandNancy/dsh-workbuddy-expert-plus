# Task 3 Report: 用 DSH token 实现胶囊样式、折叠态与动效降级

## What I implemented

- Replaced the old one-text-node `.wbx-launcher` CSS inside `MARKET_CSS` with the brief's
  Scheme B bordered-pill stylesheet:
  - Expanded state: 32px high, `999px` radius, 1px token border, layer-2 token background,
    primary label color, icon/label/caret layout, and 120ms transitions.
  - Hover: deeper `--dsw-alias-border-l3` border, `--dsw-interactive-bg-hover` background and
    a subtle shadow. Active and disabled states included.
  - Focus-visible: 2px `--dsw-alias-brand-primary` outline.
  - Collapsed rail state: `[data-wide="false"]` is exactly 36x36, centered, zero gap/padding,
    with the label and caret visually hidden via the clip-rect pattern. The icon is untouched.
  - Icon and caret colors route through label-secondary / label-tertiary tokens.
  - `prefers-reduced-motion: reduce` disables the launcher transition.
- Appended the brief's CSS contract test verbatim to `test/client-bot-ui.test.js`.
- No DOM contract, locale keys, dependencies, build steps, storage, observers, or host DOM
  injection were added or changed. `test/client-surface.test.js` was not touched.

## TDD Evidence

### RED: test appended before CSS

Command:

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-bot-ui.test.js
```

Result: 7 passed, 1 failed. Relevant output:

```text
✖ the Bot launcher stylesheet uses theme tokens and a wide-aware rail state (0.8825ms)
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /border-radius: 999px/. Input:

'.wbx-launcher { display: inline-flex; align-items: center; gap: 6px; width: 100%; padding: 7px 10px;\r\n' +
  '  border: 0; border-radius: 8px; background: transparent; cursor: pointer;\r\n' +
  '  color: var(--dsw-alias-label-secondary, inherit); font-size: 13px; line-height: 20px; text-align: left; }\r\n' +
...
ℹ tests 8
ℹ pass 7
ℹ fail 1
```

Expected failure: the extracted first `.wbx-launcher` rule was still the old
`background: transparent` / `border-radius: 8px` rule, so it had neither `border-radius: 999px`
nor the required token background/border, and no `[data-wide="false"]` rule existed.

### GREEN: after implementing the CSS

Command:

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-bot-ui.test.js test/client-surface.test.js
```

Result:

```text
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

All 8 `client-bot-ui` tests and all 12 `client-surface` tests pass. The same command was rerun
after committing `a2fc299` and again passed 20/20 with no warnings or stderr failures. A final
rerun after restoring the committed test file (to keep the worktree in sync with the index)
also passed 20/20; the log is `.superpowers/sdd/task-3-green.log`.

## Files changed

- `client/client.js` — replaced the `.wbx-launcher` CSS block and added the scoped launcher
  state rules inside `MARKET_CSS`.
- `test/client-bot-ui.test.js` — appended the brief's CSS contract test.

Commit:

```text
a2fc299 feat: style the Bot launcher as a theme-aware pill
```

Only those two files are in the commit. After the commit, `git status --short` shows only the
untracked `.superpowers/` scratch directory.

## Self-review findings

- **Token routing:** every launcher color uses a DSH token with a fallback. The only literal
  rgba values are the brief's token fallbacks plus the brief-specified
  `box-shadow: 0 1px 3px rgba(0,0,0,.08)`. No hex or other theme-color literals were added.
  A rendered-CSS audit of the launcher slice found zero hex literals.
- **Collapsed state:** `[data-wide="false"]` sets width 36px, min-width 36px, height 36px,
  padding 0, gap 0 and centers the icon. Label and caret are visually hidden with the
  clip-rect pattern (not `display:none`); the icon has no collapse rule.
- **States:** hover, active, focus-visible, disabled, and reduced-motion rules are all present
  exactly as specified.
- **Scope:** only the two permitted files changed. `test/client-surface.test.js`,
  `package.json`, locale dictionaries, and the DOM contract are untouched.
- **Verification:** `node --check client/client.js` and `git diff --check` passed before commit.
- **Whitespace:** `git diff --check` reports no errors. The test file retains the repository's
  CRLF working-copy convention.

## Concerns

The brief's CSS and its own contract test conflict in two places, so two minimal, text-neutral
deviations were required:

1. **Template-literal escaping:** the brief's comment contains Markdown backticks around `wide`
   inside the JavaScript `MARKET_CSS` template literal. Inserted literally, they terminate the
   template string and make the whole bundle a syntax error (observed: `SyntaxError:
   Unexpected identifier 'wide'`, failing both test files). They are escaped as `` \`wide\` ``,
   so the rendered CSS text is identical to the brief.
2. **Grouped selector split:** the brief groups the label and caret hidden-state selectors into
   one rule, but the brief's test specifically requires a selector whose text is
   `.wbx-launcher[data-wide="false"] .wbx-launcher-label {` followed by the clip declaration.
   The grouped form cannot match that regex. I split the one rule into two identical
   declaration blocks for the label and caret, preserving computed behavior and declaration
   text while satisfying the mandated test.

Both are recorded here because a future reader diffing against the brief will notice them.

## Reviewer fix

Commit `0308395 fix: route the pill shadow through a theme token`.

### What changed

- `client/client.js`: the hover shadow is now
  `box-shadow: var(--dsw-shadow-lv1, 0 2px 4px rgba(0,0,0,.08)); }`, replacing the
  literal `box-shadow: 0 1px 3px rgba(0,0,0,.08); }`. No other visual behavior changed.
- `test/client-bot-ui.test.js`: narrowed the base-rule extraction from
  `/\.wbx-launcher \{[\s\S]*?\n\}/` to `/\.wbx-launcher \{[\s\S]*?; \}/`, and added the
  caret clip-rect assertion plus the assertion that the collapsed icon is not hidden.

### RED: hover shadow was not token-routed

The mandated contract test does not assert the shadow token, so this was recorded with a focused
manual assertion against the pre-fix source:

```bash
node - <<'NODE'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const source = readFileSync('client/client.js', 'utf8')
const hover = source.match(/\.wbx-launcher:hover:not\(:disabled\) \{[\s\S]*?\n\}/)
assert.ok(hover, 'hover rule exists')
assert.match(hover[0], /box-shadow: var\(--dsw-shadow-lv1, 0 2px 4px rgba\(0,0,0,\.08\)\); \}/)
NODE
```

Result: exit 1 with `AssertionError [ERR_ASSERTION]`; the extracted hover rule still contained
`box-shadow: 0 1px 3px rgba(0,0,0,.08); }`. This is the expected pre-fix failure.

The refined test assertions were run before the CSS edit and reported 20/20 because the existing
CSS already satisfied the newly explicit caret/icon checks. They strengthen regression coverage
but are not behavior-change tests.

### GREEN: after the token change

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-bot-ui.test.js test/client-surface.test.js
```

Result:

```text
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

The same command was rerun after commit `0308395` and again passed 20/20 with pristine output.
Log: `.superpowers/sdd/task-3-review-green.log`.

### Narrowed-regex mutation check

The worktree was never mutated for this check. The script read `client/client.js`, extracted the
launcher base rule, removed `border-radius: 999px;` from that extracted text in memory, and then
ran the same extraction plus base-rule assertion against the mutated source. Because the file uses
CRLF, the mutation was applied to the extracted block rather than a line-ending-specific global
replace.

Output:

```text
BEFORE: base rule = 580 chars, ending "lor 120ms ease, box-shadow 120ms ease; }"
BEFORE: checks pass
AFTER MUTATION: AssertionError: The input did not match the regular expression /border-radius: 999px/.
OLD base-rule length: 3829 | NEW base-rule length: 580
OLD extraction contains data-wide: true
NEW extraction contains data-wide: false
MUTATION CHECK OK
```

This proves the narrowed regex stops at the base rule's `; }` (580 chars) instead of swallowing
later launcher rules (3829 chars), and that the base-rule assertion still fails when
`border-radius: 999px` is removed. `git diff -- client/client.js` was checked afterwards to confirm
only the intended shadow line was present until commit.
