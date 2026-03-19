```markdown
# Design System Document

## 1. Overview & Creative North Star: "The Hearthside Editorial"

This design system is built to transform a simple lunch ordering tool into a premium, homestyle culinary experience. Our Creative North Star is **"The Hearthside Editorial."** We aim to blend the warmth of a family kitchen with the sophisticated layout of a high-end food magazine.

The aesthetic avoids the "app-like" rigidity of standard SaaS platforms. Instead, we use intentional white space, varied typographic scales, and tonal layering to create an interface that feels as curated as the meals it provides. By moving away from lines and boxes toward shapes and shadows, we create a digital environment that feels "soft" yet professional, trustworthy, and human.

---

## 2. Colors & Surface Philosophy

Our palette is grounded in earthen browns (`primary`) and creamy off-whites (`surface`), refined to provide high-legibility and professional depth.

### The "No-Line" Rule
To maintain a high-end feel, **1px solid borders are strictly prohibited** for defining sections. Boundaries must be established through color shifts or elevation.
- Use `surface-container-low` (#f4f4f0) to define a secondary area on a `surface` (#faf9f5) background.
- This creates a modern, "borderless" look that feels more organic and less mechanical.

### Surface Hierarchy & Nesting
Treat the UI as physical layers of fine paper. 
- **Base Layer:** `surface` (#faf9f5).
- **Secondary Content:** `surface-container` (#eeeeea).
- **Interactive Cards:** `surface-container-lowest` (#ffffff) to make items pop naturally against the cream background.
- **Glassmorphism:** For floating elements like navigation bars or mobile menus, use `surface` with 80% opacity and a `20px` backdrop-blur.

### Signature Textures
Main Call-to-Actions (CTAs) should not be flat. Use a subtle linear gradient from `primary` (#6d5850) to `primary_container` (#877067) at a 135-degree angle. This adds a "brushed silk" quality that elevates the component.

---

## 3. Typography: The Editorial Voice

We utilize **Be Vietnam Pro** for its friendly yet geometric clarity, bridging the gap between traditional Vietnamese warmth and modern digital precision.

| Token | Size | Weight | Role |
| :--- | :--- | :--- | :--- |
| **Display-LG** | 3.5rem | 700 | Impactful hero headlines (e.g., Price displays) |
| **Headline-MD** | 1.75rem | 600 | Menu categories and section titles |
| **Title-SM** | 1.0rem | 600 | Item names and card headers |
| **Body-LG** | 1.0rem | 400 | Description text and menu details |
| **Label-MD** | 0.75rem | 500 | Metadata, timestamps, and micro-copy |

**Editorial Note:** Always pair a `headline-md` with a `body-sm` label nearby to create a high-contrast hierarchy that guides the eye.

---

## 4. Elevation & Depth

Hierarchy is achieved through **Tonal Layering**, not structural separators.

- **The Layering Principle:** A list of orders should be placed on a `surface-container-low` background, while each individual order item sits on a `surface-container-lowest` (pure white) card.
- **Ambient Shadows:** When an element needs to "float" (like a modal or a floating action button), use an extra-diffused shadow:
  - `box-shadow: 0 12px 32px -4px rgba(111, 90, 82, 0.08);` 
  - Note: The shadow uses a tint of `surface_tint` (#6f5a52) rather than grey, making it feel like warm light hitting the surface.
- **The Ghost Border:** If a form field requires a border for accessibility, use the `outline_variant` (#d4c3be) at **20% opacity**. It should be felt, not seen.

---

## 5. Components

### Menu Cards
- **Background:** `surface-container-lowest` (#ffffff).
- **Rounding:** `xl` (1.5rem) to evoke a friendly, approachable feel.
- **Content:** No dividers. Use `spacing-4` (1rem) between title and description.
- **Interaction:** On hover, shift the background to `primary_fixed` (#fadcd2) at 30% opacity for a soft, warm glow.

### Buttons
- **Primary:** Gradient fill (`primary` to `primary_container`), `on_primary` text. Rounding: `full`.
- **Secondary:** `secondary_container` (#ece0dc) background, `on_secondary_container` (#6b6360) text.
- **Tertiary:** No background. Text color `tertiary` (#8a4a36). Use for "Cancel" or "Go Back" actions.

### Input Fields
- **Container:** `surface_container_highest` (#e2e3df).
- **Rounding:** `md` (0.75rem).
- **States:** On focus, the "Ghost Border" becomes 100% `primary` opacity but remains thin (1px).
- **Labels:** Always use `label-md` in `on_surface_variant` (#504441) sitting 4px above the input.

### Order Lists
- Forbid horizontal lines. Use `spacing-2` (0.5rem) gaps between items. 
- Use a `primary_fixed_dim` (#ddc1b7) vertical accent bar (4px wide) on the left side of "Active" or "Unpaid" orders to draw attention without clutter.

---

## 6. Do's and Don'ts

### Do
- **Do** use large rounding values (`xl` and `full`) to maintain the "Soft Minimalism" aesthetic.
- **Do** use `tertiary` (#8a4a36) sparingly for accenting critical information, like the total price or an "Urgent" status.
- **Do** lean into asymmetry. For example, a menu image can slightly overflow the edge of its card container for an editorial look.

### Don't
- **Don't** use pure black (#000000) for text. Use `on_surface` (#1a1c1a) to keep the contrast soft.
- **Don't** use 1px dividers to separate items in a list. Use vertical whitespace (`spacing-6`) instead.
- **Don't** use sharp corners (`none` or `sm`). This breaks the "homestyle" trust and feels too industrial.
- **Don't** use standard blue for links. Use `tertiary` or `primary` to stay within the warm earthen palette.```