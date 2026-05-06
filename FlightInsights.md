---
name: Editorial Fintech
colors:
  surface: '#f8fafa'
  surface-dim: '#d8dada'
  surface-bright: '#f8fafa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f4'
  surface-container: '#eceeee'
  surface-container-high: '#e6e8e8'
  surface-container-highest: '#e1e3e3'
  on-surface: '#191c1d'
  on-surface-variant: '#3f484a'
  inverse-surface: '#2e3131'
  inverse-on-surface: '#eff1f1'
  outline: '#6f797a'
  outline-variant: '#bfc8c9'
  surface-tint: '#20686f'
  primary: '#004349'
  on-primary: '#ffffff'
  primary-container: '#0d5c63'
  on-primary-container: '#90d2da'
  inverse-primary: '#8fd1d9'
  secondary: '#805600'
  on-secondary: '#ffffff'
  secondary-container: '#fdba49'
  on-secondary-container: '#704b00'
  tertiary: '#5c310d'
  on-tertiary: '#ffffff'
  tertiary-container: '#784722'
  on-tertiary-container: '#fcb88a'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#abeef6'
  primary-fixed-dim: '#8fd1d9'
  on-primary-fixed: '#002023'
  on-primary-fixed-variant: '#004f55'
  secondary-fixed: '#ffddaf'
  secondary-fixed-dim: '#fdba49'
  on-secondary-fixed: '#281800'
  on-secondary-fixed-variant: '#614000'
  tertiary-fixed: '#ffdcc6'
  tertiary-fixed-dim: '#fcb889'
  on-tertiary-fixed: '#301400'
  on-tertiary-fixed-variant: '#693b17'
  background: '#f8fafa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e3'
typography:
  display-lg:
    fontFamily: Newsreader
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  display-md:
    fontFamily: Newsreader
    fontSize: 36px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 28px
    fontWeight: '500'
    lineHeight: '1.3'
  headline-md:
    fontFamily: Newsreader
    fontSize: 22px
    fontWeight: '500'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.2'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 64px
---

## Brand & Style

This design system blends the sophisticated structure of high-end financial tools with the warm, curated feel of a luxury travel magazine. It is designed specifically for London parents who value their time and seek a "knowledgeable friend" to navigate holiday planning. 

The aesthetic is **Modern Minimalist with Editorial Flair**. It rejects the coldness of traditional fintech by using a tactile, paper-like background and expressive serif typography. The interface prioritizes "quiet cleverness"—using data to provide confidence without overwhelming the user with "stock-photo energy" or aggressive marketing cues. The result is an experience that feels as reliable as a bank but as inviting as a weekend supplement.

## Colors

The palette is rooted in an off-white linen background to reduce eye strain and provide a premium, tactile foundation. **Deep Teal** serves as the primary driver of trust and authority, used for key actions and navigational anchors. **Warm Amber** is our "quietly clever" accent, used sparingly to highlight insights, curated selections, or high-value data points. 

Text follows a strict hierarchy: **Near-black** for high-readability editorial content and **Slate** for secondary metadata and captions. The **Soft Sage Green** is reserved for success states and "safe to book" indicators, maintaining the organic, sophisticated tone of the system.

## Typography

The typographic system relies on the interplay between **Newsreader** (standing in for the requested serif aesthetic) and **Inter**. 

Newsreader provides the editorial "voice"—use it for h1 through h3 to establish a literary, authoritative tone. Its variable nature allows for optical sizing that keeps headlines legible yet characterful. Inter handles the functional "data confidence"—use it for all body copy, forms, and UI labels. To maintain the premium feel, body text uses a generous 1.6 line height, ensuring that long-form trip descriptions remain effortless to read on both mobile and desktop.

## Layout & Spacing

The layout utilizes a **fixed-grid system** on desktop (12 columns, max-width 1280px) to maintain the "magazine" structure, transitioning to a fluid single-column layout on mobile. 

The rhythm is governed by a **4px base scale**. We prioritize generous whitespace (using the `xl` unit) between major sections to allow the content to "breathe," reflecting a sense of calm for busy parents. Gutters are kept wide at 24px to prevent the data-heavy fintech elements from feeling cramped or cluttered.

## Elevation & Depth

This design system uses **Tonal Layering** combined with **Ambient Shadows** to create a sophisticated sense of hierarchy. Surfaces do not "float" aggressively; instead, they sit just above the linen background.

- **Level 0 (Background):** #FAF8F4. The canvas for all content.
- **Level 1 (Cards/Surfaces):** #FFFFFF with a subtle 2px shadow (`sm`). Used for secondary content blocks.
- **Level 2 (Interactive/Active):** #FFFFFF with an 8px shadow (`md`). Used for hovered states or primary planning widgets.
- **Level 3 (Modals/Overlays):** #FFFFFF with a 16px diffused shadow (`lg`). 

Shadows should be tinted with a hint of the Primary Teal (e.g., `rgba(13, 92, 99, 0.08)`) to maintain a cohesive color story and avoid "dirty" grey shadows.

## Shapes

The shape language is **Rounded**, using a 12px (0.75rem) base radius for main components. This specific radius strikes a balance between the precision of fintech (sharp) and the friendliness of a parent-focused tool (soft). 

Buttons and input fields should strictly adhere to the 12px radius, while larger containers like cards may scale up to 16px (`rounded-lg`) to maintain visual harmony. Icons should utilize a consistent stroke weight and slightly rounded terminals to match the secondary typography.

## Components

### Buttons
Primary buttons use the **Deep Teal** background with white Inter Medium text. Secondary buttons use a **Deep Teal** outline (1px) with no background. For high-priority holiday alerts or "Book Now" actions, the **Warm Amber** can be used as a background to draw immediate focus.

### Cards
Cards are the primary vehicle for trip itineraries. They feature a white surface, a 1px border in #E2E8F0 (or subtle shadow), and 24px internal padding. Editorial cards should feature a Newsreader headline at the top, followed by a thin Teal divider (1px).

### Input Fields
Inputs use a white background with a 1px Slate border. On focus, the border shifts to Deep Teal with a subtle 2px outer glow. Labels are always positioned above the field in **Inter Label-sm (Uppercase)**.

### Trip Chips
Small metadata tags (e.g., "Term Time," "Under-5 Friendly") use a Soft Sage Green background at 10% opacity with Sage text. They use a pill-shaped radius (3) to distinguish them from interactive buttons.

### Planning Progress
A custom "Confidence Meter" component should be used, employing a thin horizontal Deep Teal line with Warm Amber markers, signaling the "Clever" data-driven nature of the tool.