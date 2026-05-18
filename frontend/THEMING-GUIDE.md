# Guardian Theming Guide

A short, opinionated guide for deployers who want to white-label Guardian
under their own brand, and for component authors who want to keep new
styles aligned with the design system.

## TL;DR

Change one file for any brand tweak:

```
src/styles/guardian-tokens.scss
```

All other styles reference tokens from it (either directly via
`--guardian-*` custom properties, or indirectly via the legacy
`--color-*` names aliased in `variables.scss`). A single token change
propagates everywhere — colours, focus rings, hover states, banners,
loaders, tables, dialogs, buttons.

For per-tenant runtime branding (different primary colour per customer),
the `BrandingService` continues to work as before — it now writes to
the same legacy variable names that token-driven components transitively
read, so tenant branding overrides cascade through the new layer
without any per-component plumbing.

## The token chain

```
src/styles/guardian-tokens.scss              ← single source of truth
  imported by
src/variables.scss                            ← legacy --color-* alias layer
  used by
src/styles/guardian.{fonts,inputs,banner,dialog,feedback,prime,patterns}.scss
  used by
every component SCSS file
```

Read top-down, every UI value originates in `guardian-tokens.scss`. The
alias layer in `variables.scss` lets older component code that hard-codes
`--color-primary` or `--primary-color` keep working, and lets the
`BrandingService` runtime override layer reach token-driven components.

## Files in this layer

| File | What it controls |
|------|------------------|
| `src/styles/guardian-tokens.scss` | **Single source of truth.** Brand colours, surfaces, text, borders, grey scale, semantic colours, typography scale + weights + tracking, radii, spacing, timings + easings, shadows, gradients, layout dimensions. |
| `src/variables.scss` | Aliases legacy `--color-*` / `--primary-color` / `--linear-gradient` etc. onto the new tokens. Both for backwards compatibility and to keep `BrandingService` runtime overrides reaching token-driven components. |
| `src/styles/guardian.fonts.scss` | `.mat-typography` sizing/weight ramp via tokens. |
| `src/styles/guardian.inputs.scss` | Form inputs scoped to `.guardian`. |
| `src/styles/guardian.banner.scss` | Alert banner types (important / warning / low / info / star), semantic-coloured. |
| `src/styles/guardian.dialog.scss` | Material + PrimeNG dialog treatments, opt-in via `.guardian-dialog` / `.guardian-p-dialog`. |
| `src/styles/guardian.feedback.scss` | **Unified 3-tier loader system**: action arc / skeleton / large ring. Plus PrimeNG progress bar with shimmer, skeleton loader, shared `.loading` wrapper, fade-in animation. |
| `src/styles/guardian.prime.scss` | PrimeNG theming through tokens: inputs, dropdowns, multi-selects, checkboxes, buttons, tabs, tables, tree-tables, paginators, color picker. Fixes the "box in a box" PrimeNG double-border bug. |
| `src/styles/guardian.patterns.scss` | Reusable admin layout primitives: page hero, stats grid, cards, badges, filter rows, stages with stagger animations, scroll-hint, user picker dialog. All opt-in. |
| `src/styles.scss` | Root import — pulls in `variables.scss` then the seven style files above, then vendor stylesheets. |

## How runtime tenant branding works

Guardian's `BrandingService` (in `src/app/services/branding.service.ts`)
loads a `BrandingPayload` from `/api/v1/branding` and writes a small set
of CSS custom properties onto `document.body`:

- `--color-primary`, `--primary-color`, `--button-primary-color`,
  `--primary-primary` — the tenant primary colour, in all four legacy
  names that historical components and the new token-driven components
  both read via the alias layer.
- `--linear-gradient` — the header gradient computed from `headerColor`
  and `headerColor1`.

Because the alias layer in `variables.scss` makes the legacy variables
resolve through tokens, these runtime overrides cascade automatically
into every token-driven style without per-component changes.

### Platform chrome vs tenant chrome

Not every Guardian route is a "tenant workspace." Operator surfaces
(`/admin`, `/branding`, `/login`, etc.) should render the platform's
own brand regardless of which tenant the user belongs to — otherwise
tenant brand colours leak into super-admin panels.

`BrandingService` exposes two predicates:

- `isPlatformChromeRoute(url)` — returns `true` for routes listed in
  `PLATFORM_CHROME_ROUTE_PREFIXES`. Deployers can extend or replace this
  list to match their own product structure.
- `isPlatformChromeRole(role)` — returns `true` for users in operator
  roles listed in `PLATFORM_CHROME_ROLES` (e.g. `AUDITOR`, `ADMIN`).
  Operator users always see platform chrome regardless of route, since
  many "operator" routes are also legitimately used by end-users with
  their own tenant brand.

`applyBrandingForRoute(url, role)` combines both signals and applies
either `DefaultBrandings` or the tenant's stored payload accordingly.

Wire this into your app shell's `Router.events` (NavigationEnd) and
your auth-state changes to re-evaluate branding on each transition.

### Preview vs production

The Branding Settings screen has a "preview" flow where an admin tries
a new colour before saving. Both preview and production paths now go
through the same `applyPrimaryColor` / `applyHeaderGradient` helpers,
so previews look exactly like what users will see in production. If
you add a new variable that primary colour should propagate to, add
it once in `applyPrimaryColor` and both flows pick it up.

## White-labelling for a new deployer brand

Two surfaces to change:

**1. Compile-time defaults** — `src/styles/guardian-tokens.scss`. Set
the entire palette here. The values resolve through the alias layer
into every component. This is the "your brand by default" pass.

**2. Runtime fallback** — `interfaces/src/helpers/default-brandings.ts`
(`DefaultBrandings`). Set the same primary colour, gradient endpoints,
company name, logo URL, favicon URL here so platform-chrome surfaces
render correctly before any tenant payload is loaded. The values
should match the token defaults.

For tenant-specific overrides (different brand per tenant), nothing
extra is needed — the existing `BrandingService.loadBrandingData`
flow already writes to the right variables and the token chain
propagates the change.

### What about logos, favicons, fonts?

- **Logos / favicons** — replace the asset files at the paths
  referenced by `DefaultBrandings.companyLogoUrl` and `faviconUrl`,
  and by the markup in `index.html`.
- **Font family** — the project loads Poppins / Inter / Lato via
  Google Fonts elsewhere in `index.html` / `styles.scss`. To switch
  fonts, replace those `@import` URLs and update the
  `--guardian-font-sans` / `--guardian-font-body` token values.
  `guardian.fonts.scss` only references the tokens, so nothing
  in that file changes.

## Author guidelines for new components

- Use `--guardian-*` tokens for any colour, font, radius, spacing,
  shadow, or animation timing. Do not hard-code hex codes or pixel
  values that the token system already covers.
- For surfaces that should pick up tenant brand colour, reference
  `var(--color-primary)` (the alias) rather than
  `var(--guardian-primary)` (the token) — this is the layer the
  runtime override targets.
- If a new pattern is needed in more than one place, add it to
  `guardian.patterns.scss` instead of repeating the styles.
- New loaders / progress states should use the 3-tier system in
  `guardian.feedback.scss` — don't reach for `<p-progressSpinner>`
  directly.

## Backwards compatibility

The token layer is additive. Existing components that hard-code
`--color-primary`, `--primary-color`, `--linear-gradient`,
`--header-*`, `--button-*`, etc. continue to work — those names are
all aliased to tokens in `variables.scss`. No component file needs
to be edited for the token system to take effect; new components
can opt into the `guardian-*` naming as they're written or refactored.

Runtime brand overrides via `BrandingService` continue to target the
same legacy variable names, so behaviour for tenants that have set a
custom brand is unchanged.
