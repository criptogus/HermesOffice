## 2025-05-20 - Accessible Color Swatches in Pickers

**Learning:** Color swatch buttons that rely solely on HTML `title` tooltips lack proper screen reader accessibility and explicit selection state feedback. Adding `aria-label` and `aria-pressed` ensures screen readers convey both the swatch's color name and whether it is currently selected.
**Action:** Whenever building or modifying color picker components or swatch grids, always include `aria-label` and `aria-pressed={isSelected}` on each interactive swatch button.
