# The look

Plain, tight, quiet. One skin: shadcn/ui (style `base-nova`, on Base UI, Remix
icons) and Vercel AI Elements for the Agent window. The tokens are one block at
the top of `app/globals.css`; this file is the rules. Build to both.

## Rules

- **Colour.** shadcn's names only: `background`, `foreground`, `card`, `popover`,
  `muted`, `muted-foreground`, `accent`, `border`, `input`, `ring`, `primary`,
  `destructive`, plus `success` and `warning` for a state. Neutrals are pure
  grey. The one colour is the person's accent (`--accent-hue`, `--accent-chroma`,
  set by `data-accent` on the root), which feeds `--primary` and `--ring`.
  Never a raw palette class, a hex, or a `dark:` colour; dark flips the tokens.
- **Radius.** `--radius` is 6px. `rounded-md` for controls, `rounded-lg` for
  what floats. Only an avatar, a status dot and a switch are round.
- **Type.** The device's own face. One scale: `text-xs` 12/16 for labels and
  captions, `text-sm` 14/20 for the body, then `text-base` 16, `text-lg` 18,
  `text-xl` 22 for titles. Weight is `font-medium` for emphasis, never bold.
- **Density.** A 4px grid. Controls are 32px (`size="default"`) or 28px
  (`size="sm"`), a row is 32 or 36. Pads are 8, 12 or 16.
- **Surfaces.** Regions are split by a hairline (`border-border`), never a card
  inside a card. Shadows only on what floats: menus, dialogs, popovers, toasts.
  No gradients, no blur on content, no decorative icons.
- **Motion.** Colour and opacity over 150ms; menus and dialogs use the
  components' own entrance. Everything holds still under reduced motion.
- **Icons.** `@remixicon/react`, passed as components. In a `Button`, mark the
  icon `data-icon="inline-start"` or `"inline-end"` and give it no size.

## Components

Take from `components/ui` before writing markup: `Button`, `Input`, `Field`,
`Select`, `ToggleGroup` (a segmented choice), `Badge` (a chip), `Item` (a row),
`Alert`, `Empty`, `Separator`, `Skeleton`, `Avatar`, `Kbd`, `Dialog`, `Sheet`,
`DropdownMenu`. Ours beside them: `CloseButton`, `StatusDot`. Add more with
`npx shadcn@latest add <name>` from `apps/web`; AI Elements come from
`https://registry.ai-sdk.dev/<name>.json`. Triggers take `render={...}`, not
`asChild`. Merge classes with `cn` from `@/lib/utils`.
