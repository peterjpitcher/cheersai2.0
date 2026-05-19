/**
 * Template registry for link-in-bio page layouts (D-08).
 * Each template defines grid columns, hero image style, bio visibility,
 * and tile rendering style.
 */

import type { LinkInBioTemplate } from './types';

export interface TemplateConfig {
  id: LinkInBioTemplate;
  name: string;
  description: string;
  tileColumns: 1 | 2 | 3;
  heroStyle: 'banner' | 'square' | 'none';
  showBio: boolean;
  tileStyle: 'card' | 'list' | 'grid';
}

export const TEMPLATES: Record<LinkInBioTemplate, TemplateConfig> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    description: 'Full-width banner hero with single-column tile cards. Best for venues with a strong hero image.',
    tileColumns: 1,
    heroStyle: 'banner',
    showBio: true,
    tileStyle: 'card',
  },
  grid: {
    id: 'grid',
    name: 'Grid',
    description: 'Two-column grid layout with square hero. Great for venues with lots of visual tiles.',
    tileColumns: 2,
    heroStyle: 'square',
    showBio: true,
    tileStyle: 'grid',
  },
  magazine: {
    id: 'magazine',
    name: 'Magazine',
    description: 'Two-column layout with banner hero and card tiles. Ideal for content-rich profiles.',
    tileColumns: 2,
    heroStyle: 'banner',
    showBio: true,
    tileStyle: 'card',
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean single-column list without hero image or bio. Focused on links only.',
    tileColumns: 1,
    heroStyle: 'none',
    showBio: false,
    tileStyle: 'list',
  },
};

/** Get the template configuration for a given template ID. */
export function getTemplate(id: LinkInBioTemplate): TemplateConfig {
  return TEMPLATES[id];
}
