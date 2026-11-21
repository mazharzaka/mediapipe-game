<<<<<<< HEAD
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
=======
# AssistiveTech Design System & Accessibility Rules (WCAG AAA)

## 1. Visual Identity (Anti-AI & Utilitarian)

- **STRICTLY BANNED:** Glassmorphism (`backdrop-blur`), neon glows, multi-color gradients, floating 3D decorative shapes, and excessive `rounded-full` containers.
- **DESIGN STYLE:** Clean, utilitarian, clinical-grade interface. Solid surfaces, crisp borders, high predictability, and zero visual noise. Every element on screen must have a functional purpose.

## 2. Color Palette & High Contrast (WCAG AAA >= 7:1)

- **Dark Mode (Default - Reduces Eye Strain):**
  - Main Canvas: `#020617` (`bg-slate-950`) or `#09090B` (`bg-zinc-950`)
  - Elevated Cards/Panels: `#18181B` (`bg-zinc-900`) with solid `1px` or `2px` border `#3F3F46` (`border-zinc-700`)
  - Primary Text: `#FAFAFA` (`text-zinc-50`)
  - Secondary Text: `#D4D4D8` (`text-zinc-300`) — Never use dim grays (`zinc-500` or darker) for readable text.
- **Semantic Action Colors (Solid & Distinct):**
  - Primary Action / Active Tracking: `#0D9488` (`bg-teal-600`) with `#FFFFFF` text.
  - Safety Stop / Emergency Pause: `#DC2626` (`bg-red-600`) with `#FFFFFF` text — Must always be the largest, most accessible button on screen.
  - Warning / Calibration Needed: `#D97706` (`bg-amber-600`).
  - Sensor Active Indicator: Solid `#22C55E` (`bg-green-500`) dot with explicit text label (never rely on color alone).

## 3. Typography & Bilingual Support (Arabic + English)

- **Font Stack:** `IBM Plex Sans Arabic` for Arabic UI, `Inter` or `Atkinson Hyperlegible` for English, and `JetBrains Mono` for live sensor coordinates (X, Y, Blink Ratio).
- **Sizing:** Minimum body text `18px` (`text-lg`). Buttons `20px` (`text-xl font-bold`). Headings `28px–36px` (`text-3xl font-bold`).
- **Spacing:** Generous line-height (`leading-relaxed`) and clear spacing between interactive blocks (`gap-6`) to prevent accidental clicks.

## 4. Motor & Visual Accessibility (a11y First)

- **Large Targets:** Every clickable button or toggle MUST be at least `56px x 56px` (`min-h-14 min-w-14`). Primary Start/Stop buttons should be full-width or at least `min-h-20`.
- **Unmistakable Focus Rings:** Every interactive element must support keyboard/switch navigation with `focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950`.
- **No Color-Only States:** Every status indicator must pair an icon + color + clear text (e.g., `[●] Tracking Active` / `[■] Paused`).
- **Dwell-Friendly Layout:** Place the most used controls in the center or corners with wide margins so head/eye tracking users don't trigger adjacent buttons by mistake.

## 5. Motion & Cognitive Load

- Respect `prefers-reduced-motion`.
- **NO** decorative bouncing, pulsing, or parallax effects.
- Transitions must be instant or subtle (`duration-150`) to confirm state changes without causing motion sickness.
>>>>>>> 88a3b5b57aa0ea31e5bc37d23af9b85341f154c7
