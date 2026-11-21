# AssistiveTech UI/UX & Accessibility Guidelines

## 1. Design Philosophy (Anti-AI Look)
- **STRICTLY PROHIBITED:** Glassmorphism, backdrop-blur, complex multi-color gradients, glowing neon shadows, and overly rounded corners (`rounded-full` for containers).
- **REQUIRED:** Flat design, utilitarian aesthetic, solid backgrounds, high contrast, clear borders, and sharp or slightly rounded corners (`rounded-md` or `rounded-lg`). The app must look like a professional, trustworthy medical/assistive software.

## 2. Color Palette & Contrast (WCAG AAA Standards)
- **Backgrounds:** Use pure solid colors. Primary background: `bg-slate-50` (Light) or `bg-zinc-900` (Dark).
- **Surfaces/Cards:** `bg-white` (Light) or `bg-zinc-800` (Dark) with a solid border `border-slate-300` / `border-zinc-600`.
- **Primary Action:** Use a highly visible, calming primary color like `bg-teal-600` or `bg-blue-600`. Text inside must be `text-white`.
- **Text:** `text-slate-900` (Light) or `text-zinc-50` (Dark) for primary text. `text-slate-600` for secondary. Never use low-contrast gray on gray.

## 3. Typography & Readability
- **Fonts:** Use highly legible, geometric or grotesque sans-serif fonts. For English: Inter or System-UI. For Arabic (if applicable): IBM Plex Sans Arabic or Cairo.
- **Sizing:** Base text size must be at least `text-lg`. Headings should be bold and distinct (`text-2xl` to `text-4xl`).
- **Spacing:** Use generous line height (`leading-relaxed`) and tracking (`tracking-wide`) to aid dyslexic or visually impaired users.

## 4. Accessibility (a11y) & Interactive Elements
- **Touch Targets:** ALL clickable elements (buttons, toggles) MUST have a minimum size of 48x48 pixels (`min-h-12 min-w-12`).
- **Focus States:** Every interactive element MUST have a highly visible focus ring for keyboard/switch navigation. Use `focus:outline-none focus:ring-4 focus:ring-teal-500 focus:ring-offset-2`.
- **States:** Clearly differentiate Hover, Active, and Disabled states. Disabled buttons must have `opacity-50` and `cursor-not-allowed`.
- **Semantics:** Always use semantic HTML tags (`<button>`, `<nav>`, `<main>`). Ensure all icons are accompanied by text labels or have descriptive `aria-label` attributes.

## 5. Animation (Minimalist)
- Avoid excessive bouncing or continuous movement that could trigger motion sickness.
- Only use functional animations (e.g., immediate state changes, simple opacity fades, or progress bars). Use Framer Motion strictly for mapping sensor data smoothly, NOT for UI decoration.
