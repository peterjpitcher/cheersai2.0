# PubHubAI Brand Style Guide

## Brand Personality
**Modern & Professional, but Warm & Approachable**
- Not corporate/sterile
- Friendly for pub owners (who aren't tech-savvy)
- Trustworthy but not boring
- Clean but with personality

---

## Style Direction Options

### Option 1: "Warm Professional" 
**Inspiration**: Notion, Linear, Cron
- Clean lines with subtle rounded corners (8-12px)
- Warm neutral palette with accent colors
- Plenty of whitespace
- Subtle shadows and depth
- Human touches (hand-drawn icons, friendly illustrations)

**Color Palette**:
```css
--primary: #2563EB (Bright blue - trustworthy)
--secondary: #F59E0B (Amber - warm, pub-like)
--background: #FAFAF9 (Warm white, not stark)
--surface: #FFFFFF
--text-primary: #18181B
--text-secondary: #71717A
--border: #E4E4E7
--success: #10B981
--error: #EF4444
```

### Option 2: "Modern Hospitality"
**Inspiration**: Airbnb, Toast POS, Square
- Softer, friendlier aesthetic
- Rounded elements (16px corners)
- Gradient accents (subtle)
- Photography-forward
- Playful micro-interactions

**Color Palette**:
```css
--primary: #7C3AED (Purple - creative, unique)
--secondary: #EC4899 (Pink - friendly, approachable)
--background: #FAF5FF (Slight purple tint)
--surface: #FFFFFF
--text-primary: #1F2937
--text-secondary: #6B7280
--border: #E5E7EB
--success: #059669
--error: #DC2626
```

### Option 3: "Craft & Character" ✨ RECOMMENDED
**Inspiration**: Craft CMS, Framer, Pitch
- Premium feel without being intimidating
- Strong typography focus
- Earth tones with vibrant accents
- Subtle textures/patterns
- Card-based layouts with depth

**Color Palette**:
```css
--primary: #EA580C (Deep orange - energetic, pub-warm)
--secondary: #0891B2 (Cyan - fresh, modern)
--background: #FFFBF5 (Cream - warm, inviting)
--surface: #FFFFFF
--text-primary: #0C0A09
--text-secondary: #57534E
--border: #E7E5E4
--success: #16A34A
--error: #DC2626
--warning: #D97706
```

---

## Typography Recommendations

### Font Pairing Options:

#### Option 1: Modern & Friendly
- **Headers**: Inter (700 weight) - Clean, modern
- **Body**: Inter (400/500) - Excellent readability
- **Accent**: Space Grotesk - Technical but approachable

#### Option 2: Character & Warmth ✨ RECOMMENDED
- **Headers**: Cal Sans (or Outfit) - Friendly, distinctive
- **Body**: Inter (400/500) - Professional, readable
- **Accent**: JetBrains Mono - For data/times

#### Option 3: Classic & Trustworthy
- **Headers**: Instrument Sans - Sophisticated
- **Body**: Source Sans Pro - Comfortable reading
- **Accent**: DM Mono - Technical elements

### Type Scale:
```css
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 1.875rem;  /* 30px */
--text-4xl: 2.25rem;   /* 36px */
```

---

## UI Patterns & Components

### Design Principles:
1. **Mobile-First**: Every component works on mobile
2. **Touch-Friendly**: Minimum 44px touch targets
3. **Consistent Spacing**: 4px grid system (4, 8, 12, 16, 24, 32, 48)
4. **Depth & Hierarchy**: Use shadows and borders wisely

### Component Styling:

#### Buttons:
```css
/* Primary Button */
.btn-primary {
  background: var(--primary);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

/* Hover state with slight lift */
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(234, 88, 12, 0.2);
}
```

#### Cards:
```css
.card {
  background: var(--surface);
  border-radius: 12px;
  border: 1px solid var(--border);
  padding: 24px;
  transition: all 0.2s;
}

/* Subtle hover effect */
.card:hover {
  box-shadow: 0 8px 24px rgba(0,0,0,0.06);
  border-color: var(--primary);
}
```

#### Forms:
```css
.input {
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 16px; /* Prevents zoom on mobile */
  transition: border-color 0.2s;
}

.input:focus {
  border-color: var(--primary);
  outline: none;
  box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.1);
}
```

---

## Iconography

### Style:
- **Line icons** (2px stroke) for most UI
- **Filled icons** for active states
- **Rounded corners** on icon strokes
- Size: 20px default, 24px for primary actions

### Recommended Icon Libraries:
1. **Lucide** (clean, consistent, open-source)
2. **Heroicons** (by Tailwind team)
3. **Tabler Icons** (huge selection)

---

## Spacing System

```css
--space-1: 0.25rem;  /* 4px */
--space-2: 0.5rem;   /* 8px */
--space-3: 0.75rem;  /* 12px */
--space-4: 1rem;     /* 16px */
--space-5: 1.25rem;  /* 20px */
--space-6: 1.5rem;   /* 24px */
--space-8: 2rem;     /* 32px */
--space-10: 2.5rem;  /* 40px */
--space-12: 3rem;    /* 48px */
--space-16: 4rem;    /* 64px */
```

---

## Animation & Micro-interactions

### Principles:
- **Subtle & Fast**: 200-300ms duration
- **Natural easing**: cubic-bezier(0.4, 0, 0.2, 1)
- **Purposeful**: Only animate for feedback/guidance

### Standard Transitions:
```css
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-slow: 350ms cubic-bezier(0.4, 0, 0.2, 1);
```

### Examples:
- Button hover: Slight lift + shadow
- Card selection: Border color + subtle scale
- Loading states: Skeleton screens, not spinners
- Success feedback: Gentle pulse or check animation

---

## Mobile-Specific Patterns

### Navigation:
- **Bottom tab bar** for primary navigation
- **Swipe gestures** for quick actions
- **Pull-to-refresh** for content updates

### Modals:
- **Bottom sheets** instead of center modals
- **Full-screen takeovers** for complex forms
- **Swipe down to dismiss**

### Touch Feedback:
```css
.touchable {
  -webkit-tap-highlight-color: rgba(234, 88, 12, 0.1);
  touch-action: manipulation; /* Prevents double-tap zoom */
}

.touchable:active {
  opacity: 0.8;
  transform: scale(0.98);
}
```

---

## Implementation with Tailwind

### tailwind.config.js:
```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: '#EA580C',
        secondary: '#0891B2',
        background: '#FFFBF5',
        surface: '#FFFFFF',
        'text-primary': '#0C0A09',
        'text-secondary': '#57534E',
        border: '#E7E5E4',
      },
      fontFamily: {
        'heading': ['Cal Sans', 'Inter', 'system-ui'],
        'body': ['Inter', 'system-ui'],
        'mono': ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        'soft': '8px',
        'medium': '12px',
        'large': '16px',
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(0,0,0,0.06)',
        'medium': '0 8px 24px rgba(0,0,0,0.08)',
        'large': '0 16px 48px rgba(0,0,0,0.12)',
      },
    },
  },
}
```

---

## Component Examples

### Campaign Card:
```tsx
<div className="bg-surface rounded-medium border border-border p-6 
                hover:shadow-medium transition-all duration-200 
                hover:border-primary cursor-pointer">
  <div className="flex items-start justify-between mb-4">
    <h3 className="font-heading text-xl text-text-primary">
      Friday Quiz Night
    </h3>
    <span className="px-3 py-1 bg-primary/10 text-primary 
                     rounded-soft text-sm font-medium">
      Active
    </span>
  </div>
  <p className="text-text-secondary mb-4">
    4 posts scheduled for this week
  </p>
  <div className="flex gap-2">
    <button className="btn-secondary">Edit</button>
    <button className="btn-primary">View Posts</button>
  </div>
</div>
```

### Mobile Navigation:
```tsx
<nav className="fixed bottom-0 left-0 right-0 bg-surface 
                border-t border-border px-4 py-2 z-50 
                md:hidden">
  <div className="flex justify-around">
    <button className="flex flex-col items-center p-2 
                       text-text-secondary active:text-primary">
      <Home size={24} />
      <span className="text-xs mt-1">Home</span>
    </button>
    {/* More nav items */}
  </div>
</nav>
```

---

## Do's and Don'ts

### DO:
✅ Use warm, approachable colors
✅ Add subtle personality through micro-interactions
✅ Keep forms simple and mobile-friendly
✅ Use plenty of whitespace
✅ Make CTAs obvious and inviting

### DON'T:
❌ Use harsh shadows or stark contrasts
❌ Create tiny touch targets
❌ Use corporate blue/gray everywhere
❌ Overcomplicate with gradients
❌ Forget loading and empty states

---

## Accessibility

- **Color contrast**: WCAG AA minimum (4.5:1)
- **Focus indicators**: Visible for keyboard navigation
- **Touch targets**: Minimum 44x44px
- **Text size**: Minimum 14px on mobile
- **Alt text**: For all images and icons