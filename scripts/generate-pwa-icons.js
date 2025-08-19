#!/usr/bin/env node

/**
 * Generate placeholder PWA icons
 * This creates simple colored squares with "CA" text as placeholders
 * Replace with actual branded icons later
 */

const fs = require('fs');
const path = require('path');

// Icon sizes needed based on manifest.json
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

// Create a simple SVG icon
const createSVG = (size) => {
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#EA580C" rx="${size * 0.1}"/>
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.3}px" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">CA</text>
</svg>`;
};

// Ensure icons directory exists
const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate each icon size
sizes.forEach(size => {
  const svg = createSVG(size);
  const filename = path.join(iconsDir, `icon-${size}x${size}.svg`);
  fs.writeFileSync(filename, svg);
  console.log(`Created ${filename}`);
});

// Also create shortcut icons
const shortcuts = ['quick-post', 'campaign'];
shortcuts.forEach(name => {
  const svg = createSVG(96);
  const filename = path.join(iconsDir, `${name}.svg`);
  fs.writeFileSync(filename, svg);
  console.log(`Created ${filename}`);
});

console.log('\nPlaceholder icons created successfully!');
console.log('Note: These are temporary SVG placeholders. For production:');
console.log('1. Create proper branded PNG icons');
console.log('2. Convert SVGs to PNGs using a tool like ImageMagick');
console.log('3. Replace the .svg files with .png files');