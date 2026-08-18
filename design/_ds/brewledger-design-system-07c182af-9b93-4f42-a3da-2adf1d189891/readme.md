# Brewledger Design System

## Overview

Brewledger is a coffeehouse retail brand: cafés, a mobile/web ordering experience, a loyalty program ("Brewledger Rewards"), and gift cards. This design system supports that product family — marketing pages, an ordering flow, product detail, and rewards.

**Sources.** No Figma file, GitHub repo, or codebase was attached to this project. The system was built from a written brand-guidelines brief describing a warm-cream/four-tier-green café retail aesthetic, structural patterns (pill buttons, floating order CTA, tiered rewards cards, feature bands), and a spacing/type scale. No logos, icons, imagery, or brand marks were supplied.

**Important note on originality.** The source brief was explicitly modeled on a well-known coffee retailer's published design system (their brand green hex values, their proprietary typeface name, their trademarked circular order-button product name, their loyalty-program name). Reproducing another company's trade dress and product naming isn't appropriate here, so this system keeps the *structure* the brief describes — the tiered-green palette, warm-cream canvas, full-pill buttons, floating circular order button, tiered rewards cards, feature bands — but reinterprets it as an **original Brewledger identity**: original color values, original naming (`Ledger Green`, `Brew Green`, `Cask Green`, `Sage`; the floating CTA is `FloatingOrderButton`, not "Frap"), and an open-source type family instead of a proprietary one. Nothing here should be treated as a reproduction of any real company's brand.

If a real Brewledger brand kit, codebase, or Figma file exists, attach it and this system should be rebuilt from that ground truth.

## Content fundamentals

No real Brewledger copy was supplied, so voice is inferred from the brief's tone (warm, confident, café-signage register) and applied consistently in placeholder copy written for this system:

- Second person, direct: "Join Brewledger Rewards," "Start an order."
- Short declarative sentences for hero moments: "The fall menu is here." "Free coffee is just the beginning."
- No emoji in body copy. A single sparkle glyph (✨) is used only on the "Customize" button, echoing the brief's note on that one spot.
- Numbers and specifics over vague claims: "Earn 1 star per $1," "190 calories, 24g sugar, 6g fat."
- Never marketing-speak superlatives ("world's best coffee") — copy stays plain and matter-of-fact, closer to café signage than ad copy.

All body copy in this system is placeholder, written to match this voice — swap for real copy when available.

## Visual foundations

- **Color:** a four-tier green system, each shade mapped to a role, not a single "brand green": `Ledger Green` (#0b6b47, headings), `Brew Green` (#14875a, CTAs), `Sage` (#3c5e54, decorative/imagery placeholders), `Cask Green` (#16302b, dark feature bands/footers). `Gold` (#c9a15b) is reserved strictly for Rewards-tier ceremony — never a general accent. Page canvas is warm cream (`Parchment` #f3f0ea / `Ceramic` #eeebe6), never pure white. Body text sits at `rgba(0,0,0,.87)`, never pure black.
- **Type:** Manrope (open-source stand-in for the brief's proprietary sans) across nearly every surface, tight `-0.01em` tracking throughout. Lora (serif) appears only for Rewards-page editorial headlines. Kalam (script) appears only for personal/handwritten touches (e.g. a cup note) — never mixed into the main shopping flow. Hierarchy comes from weight and color, not size — H1 and H2 share a size.
- **Spacing:** rem scale anchored at `1rem = 10px`, so `1.6rem = 16px` is the universal default (card padding, outer gutter, body text size). Steps up to `6.4rem` (64px) for the widest section padding.
- **Backgrounds:** solid color-block only — no gradients anywhere in the system. Imagery placeholders are flat rounded rectangles (real product photography should replace these).
- **Radius:** `12px` on every card/modal, `50px` full pill on every button, `50%` circular on the floating order button and size-selector icons.
- **Shadow:** whisper-soft and layered — 2-3 low-alpha shadows stacked (never one heavy shadow). Cards: `0 0 .5px rgba(0,0,0,.14), 0 1px 1px rgba(0,0,0,.24)`. The floating order button is the most elevated element on any screen.
- **Motion:** buttons compress to `scale(0.95)` on press as the universal active-state — the system's signature micro-interaction. Accordion expands on a measured 300ms ease-out. No bounce/springy motion except the checkbox-style overshoot curve noted in tokens (`--ease-spring`), reserved for form-control check animations.
- **Hover/press states:** buttons don't change color on hover in this build; press is communicated entirely through the scale-down. Inputs communicate state through background tint (mist-green = valid, red = invalid), not just border color.
- **Borders:** hairline `1px solid #e7e7e7` for table row separators; `1px solid var(--input-border)` (#d6dbde) for form fields.
- **Transparency/blur:** none — the system doesn't use blur or translucent glass surfaces. Alpha is used only for text-on-color opacity (white/black text ladders) and validation tints.
- **Imagery vibe:** warm, uncluttered, product-forward — inferred from the brief, not sourced. All imagery in this build is a flat placeholder block; swap in real photography before shipping.

## Iconography

No icon set, icon font, or SVG sprite was supplied. This build uses a single hand-drawn inline SVG (a cup glyph, on the floating order button) as a placeholder, plus a text star glyph (★) for the Rewards pill and a sparkle (✨) on the Customize button. **These are stand-ins, not a real icon system.** If Brewledger has a real icon library (Lucide, Heroicons, or a custom set), attach it and this system should switch to sourcing icons from it rather than ad hoc SVGs.

## Assets

No logo, product photography, or illustration assets were supplied — none are invented here. Wherever a logo would sit, the wordmark "Brewledger" is rendered in type. `assets/` is currently empty; add real logo files, photography, and gift-card illustrations here when available.

## Intentional additions

The source brief didn't enumerate a component inventory (no attached Figma/codebase), so a standard set was authored, sized to what the brief's page examples (homepage, rewards, product detail) actually use:

- `Button` (6 variants), `Input`, `Card`, `RewardsPill`, `Accordion`, `NavBar`, `FloatingOrderButton`, `FeatureBand`, `StatusPanel`.

## Fonts

Manrope, Lora, and Kalam are loaded from Google Fonts (`tokens/typography.css`) as open-source substitutes — the brief's original typefaces (a proprietary corporate sans, a custom serif) aren't publicly available. **Flag for follow-up:** if real brand font files exist, send them over and this system should switch to self-hosted `@font-face` rules using the real files.

## Index

- `styles.css` — root stylesheet, imports everything below.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `effects.css` (radius/shadow/motion).
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing groups in the Design System tab).
- `components/forms/` — `Button`, `Input`.
- `components/surfaces/` — `Card`, `FeatureBand`, `StatusPanel`.
- `components/feedback/` — `RewardsPill`, `Accordion`.
- `components/navigation/` — `NavBar`.
- `components/actions/` — `FloatingOrderButton`.
- `ui_kits/brewledger-web/` — `index.html` (home), `rewards.html`, `product.html`; `Home.jsx`, `Rewards.jsx`, `ProductDetail.jsx`.
- `thumbnail.html` — homepage tile.
- `SKILL.md` — Claude Code-compatible skill wrapper.

## Caveats & how to help iterate

- No Figma file, codebase, or brand asset kit was attached — everything visual (palette, spacing, component shapes) comes from the written brief, and all copy/imagery is placeholder.
- No logo or icon set exists in this build — plain wordmark and a couple of placeholder glyphs stand in.
- Fonts are Google Fonts substitutes, not the real Brewledger typefaces (if any exist).
- **The single biggest lever for improving this system:** attach real brand materials — a logo, product photography, an icon set, real font files, or a Figma/codebase link — and this system can be rebuilt against ground truth instead of inference.
