# Handoff: Helpdesk Full-Site Redesign

## Overview
A redesign pass across the Helpdesk HR/scheduling SaaS product, resolving two goals from the redesign brief:
1. **"Too boxy, not modern"** — replace nested bordered cards with whitespace, tone shifts, dividers, and stronger type hierarchy (Linear/Notion vocabulary). Max one level of container nesting.
2. **Light + dark mode** — both themes defined as tokens with a persisted user-facing toggle.

It also folds in the seven `area:ux` backlog items (confirmations, honest error states, half-day PTO, skippable-step distinction, message-send retry) directly into the screens they touch, and applies content-design-quality copy (specific errors, actionable empty states, one term — "time off" — app-wide).

## About the Design Files
The `.dc.html` files in this bundle are **design references** — HTML/JS prototypes showing intended look and behavior. They are **not production code to copy directly**. The task is to **recreate these designs in the Helpdesk codebase's existing environment** (Next.js App Router + React 19 + TypeScript, per the brief) using its established component patterns, and to define the color values below as CSS-variable design tokens (the brief specifically calls out replacing scattered `#1a1a1a`/`#185fa5` literals with tokens). Check whether `next-themes` (or equivalent) is already a dependency before adding one for the theme toggle.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, and interactions. Recreate pixel-close using the codebase's existing libraries/patterns. Note: the accent hue shipped here is the brief's blue (`#185fa5` family, expressed in OKLCH below); several alternative accents were explored and rejected in favor of keeping blue.

## Screens / Views

All screens share: a left sidebar (224px) OR a top header depending on surface, an inline SVG logomark (rounded-square badge with a plus/cross glyph), per-item nav icons, a persisted light/dark toggle (circular 36px button, sun/moon icon), and divider-based sectioning instead of nested cards.

### 1. Dashboard (`Dashboard.dc.html`)
- **Purpose**: Owner's morning overview.
- **Layout**: 224px sidebar + fluid content. Content max flow with 40px horizontal padding, 48px vertical gaps between sections.
- **Components**: Greeting header (28px/800 headline, secondary date line with a rotated-square accent motif); 4-column stat row separated by 1px left-borders (no card boxes), each stat has a small colored "tick" bar above a 30px/800 number and a delta line color-coded good/warn/neutral; "Needs your attention" list with per-type icons (calendar/doc/clock/person) in 32px rounded-square tinted tiles + pill action buttons; "Upcoming" list in one elevated panel; "Recent activity" list with 30px avatar initials (blue, some amber).

### 2. Settings (`Settings.dc.html`)
- **Purpose**: Company/appearance/notification settings + section nav.
- **Layout**: 224px section nav (General/Billing/Integrations/Team/Danger zone, each with icon) + 760px content.
- **Components**: Divider-separated rows (Company fields, Appearance theme picker as a segmented control, Email-notifications toggle switch), Save with "Saved" flash. Danger-zone section text uses error color.

### 3. Payroll (`Payroll.dc.html`)
- **Purpose**: Run payroll + view history.
- **Components**: "Run payroll" button → spinner → success banner ("Payroll run started for 14 employees, totaling $28,910. Direct deposits land in 1–2 business days."). 3-stat row (divider-separated, tick bars). Pay-history table combining **manual entries and scheduled runs in one list** — important: per ARCHITECTURE.md there are two non-communicating payroll write paths; the UI shows both, manual entries visually tagged (amber, weight 600). Don't imply merged data.

### 4. Careers Apply Page (`Careers Apply Page.dc.html`)
- **Purpose**: Public job-application page (logged-out, strongest first impression).
- **Layout**: Centered 880px column, top bar with company name + theme toggle, tone-shift hero band (not a bordered card), then role detail sections and the form.
- **Components**: 44px/800 job title; responsibilities (check icons) + requirements (bullet) lists; About band (single tone-shift section); apply form with two-column grids, **drag-and-drop resume upload** with empty/uploading/done/error states and specific validation copy ("That file is over 10MB — try a smaller or compressed version."); inline field errors; Submit → spinner → success state ("Application received").

### 5. AI Assistant (`AI Assistant Page.dc.html`)
- **Purpose**: Standalone in-app AI assistant (distinct from the ChatWidget popup).
- Empty state is an invitation with suggested prompts; conversation view; message composer.

### 6. Employee Portal (`Employee Portal.dc.html`)
- **Purpose**: Employee self-serve (absorbs the parallel `employee/page.tsx` surface — brief decision: consolidate into `portal/`).
- **Components**: Hours-this-period summary, time-off request form **with half-day option** (JAY-129 — balance API already supports it), documents, pending-request states. Amber used for "this pay period" label + pending tags.

### 7. Employee Panel (`Employee Panel.dc.html`)
- **Purpose**: Admin editing one employee.
- **JAY-125 fix**: "Remove employee" now opens a confirmation modal requiring the admin to **type the employee's name** before the destructive button enables — no longer a one-click delete sitting next to Save.

### 8. Settings Danger Zone (`Settings Danger Zone.dc.html`)
- **JAY-127 fix**: Account deletion **checks the API response** before showing success. Includes a distinct failure state ("The deletion didn't go through — our server didn't confirm it completed. Your account and data are untouched.") and a type-to-confirm ("delete <company>") gate.

### 9. Onboarding Flow (`Onboarding Flow.dc.html`)
- **JAY-128 fix**: Legally-required steps (W-4/I-9/direct deposit) show a "Required by law — can't be skipped" badge and a **disabled** skip control; genuinely optional steps show an "Optional" badge and a skip **confirmation** explaining the consequence. Step progress dots at top.

### 10. Messages (`Messages.dc.html`)
- **JAY-131 fix**: A failed message send **keeps the draft in the input**, shows an inline "Didn't send — network dropped" with a **Retry** action, and never silently clears — no false data-loss.

## Interactions & Behavior
- **Theme toggle**: persisted to `localStorage` key `helpdesk-careers-theme` (`'light'`/`'dark'`); restored on mount. Replace with the codebase's theme mechanism (`next-themes`) on implementation.
- **Destructive confirmations** (JAY-125/127): type-to-confirm gating; buttons disabled until match; in-flight disabled + spinner state.
- **File upload** (Careers): drag-over highlights dropzone; validates extension (.pdf/.doc/.docx) and size (≤10MB) with specific error copy; uploading spinner → done chip with filename + size + Remove.
- **Async actions**: Save/Run payroll/Submit/Delete all show spinner + disabled state, then success/flash.
- **Message send**: Enter sends (Shift+Enter newline); simulated failure path preserves draft + Retry.

## State Management
Per-screen local state: `theme`, form fields + `errors` map, upload `status` (empty/uploading/done/error), async `phase` (idle/submitting/success/error), modal open + confirm-text, onboarding `stepIndex`, active nav/section, message threads + draft + send-error. On implementation these map to component state / server actions; wire real API responses where the prototypes simulate with `setTimeout`.

## Design Tokens

Colors are OKLCH. Two themes; accent family shared across both (only contrast/background shifts).

**Dark**
- bg `oklch(17% 0.012 260)` · bg-elevated `oklch(21% 0.014 258)` · bg-input `oklch(25% 0.015 258)`
- border `oklch(28% 0.018 258)` · text `oklch(95% 0.006 90)` · text-secondary `oklch(72% 0.02 250)` · text-tertiary `oklch(52% 0.02 250)`
- accent `oklch(64% 0.15 250)` · accent-text `oklch(99% 0 0)` · amber (secondary) `oklch(70% 0.15 55)`
- success `oklch(68% 0.15 145)` · warn `oklch(75% 0.14 85)` · error `oklch(72% 0.16 25)`

**Light**
- bg `oklch(98% 0.004 90)` · bg-elevated `oklch(95% 0.006 85)` · bg-input `oklch(91% 0.008 85)`
- border `oklch(88% 0.01 90)` · text `oklch(22% 0.01 260)` · text-secondary `oklch(42% 0.015 255)` · text-tertiary `oklch(58% 0.015 255)`
- accent `oklch(48% 0.14 250)` · accent-text `oklch(99% 0 0)` · amber `oklch(58% 0.16 55)`
- success `oklch(45% 0.13 145)` · warn `oklch(50% 0.13 85)` · error `oklch(50% 0.19 25)`

**Type**: Inter (400–800). Headlines 28px/800, letter-spacing -0.02em; large numerals 30px/800; body 14–17px; labels 13px/600, uppercase 0.04em for section eyebrows.
**Radius**: buttons/inputs 8–10px; nav items 7px; pills 999px; logomark 7px; tinted icon tiles 9px.
**Spacing**: 40px section padding, 48px between major sections, 20–24px within groups.

## Assets
- **Logomark**: inline SVG (rounded-square + plus/cross glyph), tinted with accent.
- **Icons**: all inline SVG (nav, attention-item types, toggle sun/moon, form states). No icon-font dependency; swap for the codebase's icon library (e.g. lucide) on implementation.
- No raster images; avatars are initials on colored circles.

## Files
- `Dashboard.dc.html`, `Settings.dc.html`, `Payroll.dc.html`, `Careers Apply Page.dc.html`, `AI Assistant Page.dc.html`, `Employee Portal.dc.html`, `Employee Panel.dc.html`, `Settings Danger Zone.dc.html`, `Onboarding Flow.dc.html`, `Messages.dc.html`

Each is a self-contained Design Component: an inline-styled template plus a `Component` logic class (state, handlers, `renderVals()` returning template inputs). Read them as behavior/layout references, not as code to port verbatim.
