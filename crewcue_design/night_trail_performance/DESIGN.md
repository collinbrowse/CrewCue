---
name: Night Trail Performance
colors:
  surface: '#fcf9f0'
  surface-dim: '#dddad1'
  surface-bright: '#fcf9f0'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3ea'
  surface-container: '#f1eee5'
  surface-container-high: '#ebe8df'
  surface-container-highest: '#e5e2da'
  on-surface: '#1c1c17'
  on-surface-variant: '#484553'
  inverse-surface: '#31312b'
  inverse-on-surface: '#f4f1e8'
  outline: '#797584'
  outline-variant: '#c9c4d5'
  surface-tint: '#5e4ac3'
  primary: '#5440b9'
  on-primary: '#ffffff'
  primary-container: '#6d5ad3'
  on-primary-container: '#f3edff'
  inverse-primary: '#c9bfff'
  secondary: '#0058be'
  on-secondary: '#ffffff'
  secondary-container: '#2170e4'
  on-secondary-container: '#fefcff'
  tertiary: '#4e5566'
  on-tertiary: '#ffffff'
  tertiary-container: '#666d7f'
  on-tertiary-container: '#ecf0ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5deff'
  primary-fixed-dim: '#c9bfff'
  on-primary-fixed: '#1a0063'
  on-primary-fixed-variant: '#462faa'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#dce2f7'
  tertiary-fixed-dim: '#c0c6db'
  on-tertiary-fixed: '#141b2b'
  on-tertiary-fixed-variant: '#404758'
  background: '#fcf9f0'
  on-background: '#1c1c17'
  surface-variant: '#e5e2da'
typography:
  display:
    fontFamily: Lexend
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Lexend
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.0'
    letterSpacing: 0.05em
  button-text:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: '1.0'
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  base: 8px
  container-margin: 24px
  gutter: 16px
  stack-sm: 12px
  stack-md: 24px
  stack-lg: 48px
---

## Brand & Style

The design system is built for the high-performance trail running community. Originally conceived for "Night Mode," this update transitions the brand into a **light-mode primary experience** that maintains the premium reliability of high-end outdoor gear. It shifts from the immersive "under the stars" feel to a crisp, high-visibility "daylight" aesthetic suitable for all-day technical use.

The style is **Corporate / Modern with Minimalist influences**, emphasizing:
- **Clarity:** Bright, clean backgrounds that ensure maximum legibility of essential technical data under direct sunlight.
- **Premium Performance:** Technical typography and high-contrast primary actions that command attention against a clean canvas.
- **Energy:** Vibrant accent colors that suggest movement and athletic vitality in all environments.
- **Efficiency:** Generous whitespace and clean line-art illustrations that remain unmistakable during physical activity.

## Colors

The palette is now anchored by a warm, off-white neutral base that provides a comfortable foundation for daytime legibility.

- **Primary Action:** A distinct purple (#6D5AD3) is reserved for the most important user journey steps, ensuring high visibility and brand recognition.
- **Secondary Accent:** A vibrant royal blue (#3B82F6) is used for status indicators, icons, and interactive elements that require differentiation from primary actions.
- **Typography:** Deep charcoal-black (#111827) provides maximum legibility for data-heavy trail metrics.
- **Neutral Base:** The soft off-white foundation (#F7F4EB) is complemented by tonal light grey surfaces for cards and containers to create subtle depth and hierarchy.

## Typography

The system utilizes two distinct typefaces to balance athletic motivation with technical precision. 

**Lexend** is used for headlines and displays. Its design was specifically influenced by reading speed and clarity, making it the perfect "athletic" sans-serif for runners glancing at screens mid-stride.

**Inter** is the workhorse for body copy and data labels. It provides a clean, neutral, and highly technical tone that ensures performance metrics and navigation instructions are unmistakable. 

Hierarchy is established through weight shifts (SemiBold for interactive labels) and subtle tracking adjustments on all-caps sub-headers to improve scan-ability.

## Layout & Spacing

The layout follows a **fluid grid** model with generous safe-area margins. 

- **Vertical Rhythm:** Elements are stacked using an 8px base unit. Primary content blocks are separated by `stack-lg` (48px) to maintain a premium, breathable feel.
- **Margins:** A standard 24px horizontal margin ensures content remains clear of bezel edges on mobile devices.
- **Density:** While the overall brand is "breathable," technical data components (like splits or elevation charts) use a tighter `stack-sm` (12px) rhythm to keep related information grouped together.

## Elevation & Depth

Visual hierarchy is communicated through **tonal layering** and **soft ambient shadows** rather than high-contrast glows.

- **Tonal Depth:** Higher elevation is represented by lighter, white surface colors against the off-white base.
- **Tiers:** 
  - **Level 0 (Base):** #F7F4EB (The ground).
  - **Level 1 (Cards):** Pure white surfaces with a very subtle 1px border (#C9C4D5) and a soft, diffused shadow to define edges.
  - **Level 2 (Active Elements):** Elevated surfaces with increased shadow depth to indicate "press-ability."
- **Glassmorphism:** Use background blurs (20px) on sticky navigation bars to maintain a sense of context while keeping the interface feeling light and airy.

## Shapes

The design system adopts a **pill-shaped** language to reinforce its friendly and approachable personality. 

- **Buttons & Chips:** All primary and secondary buttons are fully rounded (capsule style).
- **Cards & Inputs:** Use the `rounded-xl` (32px) setting to maintain a soft, modern aesthetic that feels comfortable and premium.
- **Icons:** Housed in circular containers to mirror the button geometry.
- **Illustrations:** Use flowing, organic lines that avoid sharp angles, reflecting the natural curves of outdoor trails.

## Components

### Buttons
- **Primary:** Purple background (#6D5AD3) with white text. Pill-shaped, high vertical padding (16px+).
- **Secondary:** Blue background (#3B82F6) with white text. Used for secondary navigation or utility actions.
- **Tertiary/Ghost:** Outline style with a 2px charcoal-black border (#111827) and matching text.
- **Social Auth:** Large light-grey pill-shaped buttons with integrated brand icons.

### Inputs
- **Field Style:** Pure white background with a subtle border. On focus, the border transitions to Blue (#3B82F6) with a soft shadow effect.
- **Labels:** Positioned above the field in `label-caps` typography using the charcoal-black accent.

### Progress & Metrics
- **Activity Rings:** Use the royal blue accent for progress with a slight luminosity against a light-grey track.
- **Data Chips:** Small pill-shaped containers with tonal backgrounds used to display trail difficulty, distance, or weather.

### Cards
- **Trail Cards:** Pure white base with a large corner radius (32px). Feature a header image with a subtle gradient overlay for text legibility.
- **Navigation:** Floating bottom bars with high blur and pill-shaped active states for menu items.