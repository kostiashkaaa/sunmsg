# SVG Icon System (SUN Messenger)

## Goals
- Crisp lines on all DPI screens.
- One visual language for buttons and menu icons.
- Safe gradual migration from `bootstrap-icons` (`<i class="bi ...">`) to inline SVG.

## Core Rules
- Use only `<svg class="sun-icon"><use href="#sun-i-..."></use></svg>` for UI-line icons.
- Keep icon geometry in `24x24` viewBox.
- Use one stroke token: `--sun-icon-stroke: 1.85`.
- Never scale icons with CSS `transform: scale(...)`.
- For button icons, inherit size from `font-size` (`1em` sizing in `.sun-icon`).

## Sprite + Styles
- Sprite: `templates/chat/_svg_icons_sprite.html`
- Styles: `static/pages/chat/svg-icons.css`
- Dynamic adapter for legacy `bi` classes: `static/modules/bi-icon-adapter.js`
- Connected in:
  - `templates/chat.html`
  - `templates/chat/_head.html`
  - `templates/chat/_scripts.html`

## Usage Example
```html
<button class="btn-icon" type="button" aria-label="Search">
  <svg class="sun-icon" aria-hidden="true">
    <use href="#sun-i-search"></use>
  </svg>
</button>
```

## Migration Policy
- Static buttons can use direct SVG markup immediately.
- Dynamic icons can stay as `<i class="bi bi-...">`; adapter replaces them with SVG at runtime and tracks class changes.
