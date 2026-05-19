/**
 * Template registry: maps template ID to the corresponding React component.
 * Fallback: ClassicTemplate if unknown template ID is provided.
 */

import type { LinkInBioTemplate } from '@/lib/link-in-bio/types';
import { ClassicTemplate } from './classic';
import { GridTemplate } from './grid';
import { MagazineTemplate } from './magazine';
import { MinimalTemplate } from './minimal';

type TemplateComponent = typeof ClassicTemplate;

const TEMPLATE_COMPONENTS: Record<LinkInBioTemplate, TemplateComponent> = {
  classic: ClassicTemplate,
  grid: GridTemplate,
  magazine: MagazineTemplate,
  minimal: MinimalTemplate,
};

export function getTemplateComponent(template: LinkInBioTemplate): TemplateComponent {
  return TEMPLATE_COMPONENTS[template] ?? ClassicTemplate;
}
