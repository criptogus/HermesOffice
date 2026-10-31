## 2025-05-20 - Accessible Color Swatches in Pickers

**Learning:** Color swatch buttons that rely solely on HTML `title` tooltips lack proper screen reader accessibility and explicit selection state feedback. Adding `aria-label` and `aria-pressed` ensures screen readers convey both the swatch's color name and whether it is currently selected.
**Action:** Whenever building or modifying color picker components or swatch grids, always include `aria-label` and `aria-pressed={isSelected}` on each interactive swatch button.

## 2025-05-21 - Accessible Custom Tab Bars and Action Buttons

**Learning:** Custom tab strip `div` elements with pointer listeners lack `role="tablist"` / `role="tab"`, `aria-selected`, `tabIndex`, and keyboard activation listeners. Also, generic close button labels like "Close tab" are ambiguous when multiple tabs exist. Including `role="tablist"`, `role="tab"`, `aria-selected={active}`, roving `tabIndex`, `Enter`/`Space` key handlers, and tab-titled aria labels (`Close tab - [title]`) makes custom tab strips fully accessible to screen readers and keyboard navigation.
**Action:** When building custom tab strips, always set `role="tablist"` on the container and `role="tab"`, `aria-selected`, roving `tabIndex`, keyboard listeners, and tab-specific aria-labels on action buttons inside each tab.
