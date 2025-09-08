Contributing Guidelines

Development
- Install dependencies: npm ci
- Run dev server: npm run dev
- Lint locally: npm run lint && npm run lint:ci

Design System & Visual Regression
- Storybook: npm run storybook
- Stories live in stories/ and co-located component folders.
- On pull requests, Chromatic publishes a build (requires CHROMATIC_PROJECT_TOKEN repo secret). Review and approve visual diffs in Chromatic.

Accessibility & Style Enforcement
- ESLint enforces JSX a11y and Tailwind classname order.
- Use design tokens and CSS variables. Hex colors are not allowed in CSS (define tokens in app/globals.css instead).
- Buttons must use spacing tokens via the shared Button component.

Navigation Labels
- Edit nav copy in lib/nav.ts. Header and sub-nav consume from here.

Testing
- Unit tests: npm test
- Visual: review Chromatic builds on PRs.

