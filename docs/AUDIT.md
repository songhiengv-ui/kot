# Phase 0 — Audit of the Claude Design project

Source: claude.ai/design project `ede509c8-…` → copied to `design/` (read-only reference, do not edit).
Files: `Kat Finance v2.dc.html` (1,656 lines), `support.js` (Claude Design runtime, generated). `Kat Finance.dc.html` (v1) exists remotely, not imported.

## What it is

Not an application codebase. It's one self-contained **Claude Design component**:

- `<x-dc>` template DSL (`sc-if`, `sc-for`, `{{ }}` bindings, `style-hover`) rendered by `support.js` into React (via `window.React`).
- One class component (`DCLogic`) with all state in memory, one giant `rv()` view-model function (~300 lines).
- Inline styles everywhere; no CSS classes, no Tailwind, no TypeScript, no build, no tests, no lint.
- Rendered inside a fake 390×844 iPhone frame (status bar, notch, home indicator) with a "Jump to" guide sidebar.

**Reuse verdict:** reuse the *design* (layout, tokens, copy, flows, logic ideas). The *code* cannot be carried over as-is — the DSL and runtime are design-tool-only. Porting to React/TSX is a re-expression of the same UI, not a redesign.

## Screens present (all in one file)

| Screen | State in design | Notes |
|---|---|---|
| Onboarding (2 steps: language, mic) | Done | Good. Needs auth step inserted. |
| Home | Done | Balance card, In/Out/Net 30d, account carousel, 4 quick actions, repeat chips, category mix bar, recent list, empty state. Mic reachable without scroll ✓ |
| Activity (transactions) | Done | Search, type/account/category chips, grouped by day, day totals. |
| Accounts | Done | List, manual-balance disclaimer, transfer entry, archived section, import "coming soon". |
| Account detail (sheet) | Done | Balance, 30d in/out/transfer, last 6 tx, edit/transfer/archive. |
| Add/Edit account (sheet) | Done | Kind, name, currency, opening balance, color. |
| Voice capture (full screen, dark) | **Simulated** | Scripted word-by-word "transcription" from 8 hardcoded scenarios. |
| Voice review | Done (UI) | Per-item cards, inline ambiguity resolution (currency / account / destination), auto-save countdown. |
| Quick text entry (sheet) | **Real regex parser** | Live preview while typing, per-item fixes, account chips, suggestions. |
| Edit transaction / new transfer (sheet) | Done | Type segment, amount, currency, accounts, category grid, note, day, delete, transfer impact preview. |
| Insights | Done | 7d/30d, currency filter, headline + vs previous period, bar chart (CSS), by category, by account, in vs out, "Ask" chips, goals. |
| Mode switcher (Personal/Business sheet) | Done | |
| Settings | Done | Language, exchange rate (3 presets), Khmer numerals, mic, simulated offline, demo-data actions. |
| Toast with Undo | Done | Used for save / edit / delete / archive. |
| Login/Signup, desktop layout | **Missing** | |

## Real vs mocked

| Real (logic worth porting, with fixes) | Mocked / must be replaced |
|---|---|
| km/en dictionary (~150 keys, complete) | All voice recognition (scripted scenarios) |
| Category + account-kind catalogs, icons, colors | All data (seeded, in memory, lost on reload) |
| Khmer digit display + parsing | Auth / user ("Sokha", fake +855 number) |
| Text parser (`parseOne`): amount, `k`/`ពាន់`, $/riel, accounts, income/transfer keywords, multi-item split | Offline "save & sync later" (just a flag) |
| Ambiguity flags: missing currency, missing account, missing transfer destination, same-account transfer | "Ask about your money" (labelled DEMO; actually deterministic — keepable) |
| Balance, insights, filters, repeat-suggestions computations | Budget ($450) and savings goal ($1,500) hardcoded |
| Undo pattern for every write | Statement import (correctly marked "coming soon") |

## Defects found in the prototype logic (must not be ported)

1. **Floats for money** — `parseFloat`, `amount: 2.5`, `v/rate`. Violates the integer rule.
2. **Historical balances change when the exchange rate changes.** `bal()` converts cross-currency transactions at the *current* rate every render. A KHR expense paid from a USD account must be frozen in the account's currency at entry time.
3. **`ម៉ឺន` (10,000) and `លាន` (1,000,000) are not parsed.** "៥ ម៉ឺន" → amount 5, no currency → offers "5,000 ៛ or $5". The correct 50,000 ៛ is not even an option. Same for "១ សែន" (100,000).
4. **Voice auto-save after 2.7 s** silently falls back to the *default account* when none was spoken (`usedPref`). That's an assumption saved without confirmation.
5. **"≥ 1000 means riel" heuristic** in text parsing — guesses currency silently. Acceptable only if shown and editable; never for voice.
6. Dates are "days ago" offsets, not timestamps; times are local strings. No timezone handling.
7. Account IDs from `Date.now()`; tx IDs from a counter. No idempotency.

## Mobile/a11y/perf observations

- Every control is a `<div onClick>` — no buttons, no labels, no focus ring, not keyboard-reachable.
- Muted text `#8C8D84` on `#F4F2EC` ≈ 3.0:1 contrast; fails WCAG AA at the 11–13 px sizes it's used at. Needs a darker muted token.
- Several targets < 44 px: filter chips (~30 px), toast Undo, ask chips, search clear icon.
- Fonts: Geist + Kantumruy Pro + full **Material Symbols Rounded variable font** (very heavy). Must subset icons (Google Fonts `icon_names=` param) or inline SVGs.
- Income vs expense distinguished by +/− sign as well as color ✓. Transfers have distinct icon + color ✓.
- Fixed 390 px frame; no tablet/desktop layout; no safe-area insets (fake ones baked in).
- Animations are CSS keyframes only — cheap ✓. Needs `prefers-reduced-motion`.

## Design tokens (extracted)

```
bg        #F4F2EC   surface #FFFFFF   sunken #F0EEE7 / #ECE9E1 / #E9E6DE
ink       #191A17   ink-2 #3B3C36     muted #5F6159   faint #8C8D84 (decorative only)
line      #E6E3DA
accent    #2E6B5B   accent-bg #E3EDE8 (income, primary)
transfer  #4A5E86   transfer-bg #E4E8F1
warn      #8A5A12   warn-bg #F6EAD3   (ambiguity, offline)
danger    #B4483C
voice bg  #131511   voice card #1E211C   voice accent #9CCBB8
accounts  ABA #33506E · ACLEDA #8A6A3A · Wing #5E7A3A · Cash #4A4B45 · Other #7A4E5E
radius    10 / 14 / 18 / 22 / 26 / sheet 30
fonts     Geist (Latin, numbers) + Kantumruy Pro (Khmer); tabular-nums for amounts
```

Note: brand colors are *evocative*, not official bank marks — keep it that way (no logos, no implied partnership).
