# Appearance

Transient opens in dark mode unless you have saved a different choice. The moon
and sun control in navigation changes the theme immediately and remembers it on
this device. Settings → Appearance also saves the choice to your account and
offers System mode, which follows changes in the device's appearance.

Dark mode uses a black canvas, burgundy actions, maroon selection surfaces, and
soft red accents for readable labels. Light mode uses white, black, and neutral
grays. Status labels and symbols remain visible in both modes.

Glass is reserved for navigation, selection lenses, and sheets. Shift data stays
on opaque surfaces. Safari gets prefixed backdrop blur; reduced transparency
uses opaque surfaces, increased contrast adds edges, and reduced motion disables
the selection springs. Apple devices use their system font; other devices use
Inter. The native status bar follows the selected mode.

## Icons

The glass-lens mark is defined in `src/lib/brand-icon.ts`. The web mark adapts to
the current theme. Launcher and PWA icons retain the black/burgundy brand plate.
Android foreground and background are generated separately; iOS receives an
opaque square that the operating system masks. Rebuild all assets with:

```sh
pnpm mobile:icons
```

This also regenerates the PWA icons, manifest, vector source, and black launch
screens. Generated native assets are committed; working source PNGs in
`mobile/assets` are recreated by the command.

## Design references and checks

The implementation adapts [Apple Design](https://github.com/bowen31337/apple-design)
material and motion recipes, with the requested palette taking precedence.
[Frontend Design](https://github.com/anthropics/skills/tree/main/skills/frontend-design)
and [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
guide hierarchy, touch targets, and accessibility. These skills are installed
locally in `~/.codex/skills` and are available for future tasks.

`pnpm contrast:check` reads the actual CSS tokens and verifies text, button,
outline, and focus pairings in both modes, including conservative backgrounds
through glass. `pnpm contrast` regenerates `docs/contrast.md`.

## App preview

Run `pnpm dev`, then open `/dev/app` to inspect the actual guard dashboard, report list, appearance settings, and a read-only shift timeline with sample data. This route is disabled outside development. It does not require sign-in or a database, and cannot write shift records or download real reports. The production `/dashboard` uses the same dashboard components with authenticated, scoped data.
