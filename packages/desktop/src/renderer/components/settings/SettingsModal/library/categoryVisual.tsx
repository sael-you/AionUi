/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One icon and one tone per category (C33), shared by skills (categories =
 * the seeded kits K1…K12, Built-in, Other, Project) and MCPs (catalogue
 * categories), so "SEO" looks the same on both pages. The tile is an Arco
 * `Tag` in a preset colour: Arco supplies the light and dark palette.
 */

import { Tag } from '@arco-design/web-react';
import {
  Announcement,
  Apple,
  BookOpen,
  Box,
  Browser,
  ChartLine,
  Code,
  Data,
  Earth,
  FolderOpen,
  Laptop,
  Lightning,
  Mail,
  Microscope,
  Phone,
  Picture,
  Platte,
  Puzzle,
  Rocket,
  Search,
  Server,
  Target,
  Wallet,
} from '@icon-park/react';
import React from 'react';
import { categoryTone, type CategoryTone } from './libraryModel';
import styles from './Library.module.css';

/** A visual id shared by kit categories and MCP catalogue categories. */
export type CategoryVisualId =
  | 'developer'
  | 'ops'
  | 'backend'
  | 'payments'
  | 'analytics'
  | 'seo'
  | 'cro'
  | 'email'
  | 'ads'
  | 'research'
  | 'design'
  | 'docs'
  | 'data'
  | 'media'
  | 'builtin'
  | 'project'
  | 'global'
  | 'other'
  // Settings → Devices (C38): one per device kind.
  | 'server_browser'
  | 'my_browser'
  | 'phone'
  | 'addon'
  | 'mac';

type IconComponent = typeof Code;

const VISUALS: Record<CategoryVisualId, { icon: IconComponent; tone: CategoryTone }> = {
  developer: { icon: Code, tone: 'arcoblue' },
  ops: { icon: Rocket, tone: 'purple' },
  backend: { icon: Server, tone: 'cyan' },
  payments: { icon: Wallet, tone: 'green' },
  analytics: { icon: ChartLine, tone: 'blue' },
  seo: { icon: Search, tone: 'orangered' },
  cro: { icon: Target, tone: 'magenta' },
  email: { icon: Mail, tone: 'pinkpurple' },
  ads: { icon: Announcement, tone: 'gold' },
  research: { icon: Microscope, tone: 'cyan' },
  design: { icon: Platte, tone: 'magenta' },
  docs: { icon: BookOpen, tone: 'lime' },
  data: { icon: Data, tone: 'blue' },
  media: { icon: Picture, tone: 'pinkpurple' },
  builtin: { icon: Lightning, tone: 'arcoblue' },
  project: { icon: FolderOpen, tone: 'green' },
  global: { icon: Earth, tone: 'arcoblue' },
  other: { icon: Puzzle, tone: 'purple' },
  server_browser: { icon: Browser, tone: 'cyan' },
  my_browser: { icon: Laptop, tone: 'arcoblue' },
  phone: { icon: Phone, tone: 'green' },
  addon: { icon: Puzzle, tone: 'purple' },
  mac: { icon: Apple, tone: 'gold' },
};

/** Seeded kits (C27/C28) by builtin key. */
const KIT_VISUALS: Record<string, CategoryVisualId> = {
  K0: 'global',
  K1: 'developer',
  K2: 'ops',
  K3: 'backend',
  K4: 'payments',
  K5: 'analytics',
  K6: 'seo',
  K7: 'cro',
  K8: 'email',
  K9: 'ads',
  K10: 'research',
  K11: 'design',
  K12: 'docs',
};

/** MCP catalogue categories (`MCP_TEMPLATE_CATEGORIES`). */
const MCP_VISUALS: Record<string, CategoryVisualId> = {
  developer: 'developer',
  payments: 'payments',
  analytics: 'analytics',
  seo: 'seo',
  ads: 'ads',
  email: 'email',
  data: 'data',
  research: 'research',
  media: 'media',
  other: 'other',
};

/** Visual id of a seeded kit, `null` for the owner's own kits. */
export const kitVisualId = (builtinKey: string | undefined): CategoryVisualId | null =>
  (builtinKey && KIT_VISUALS[builtinKey]) || null;

/** Visual id of an MCP catalogue category. */
export const mcpCategoryVisualId = (category: string): CategoryVisualId => MCP_VISUALS[category] ?? 'other';

export type CategoryIconProps = {
  /** A known visual, or any key (an owner's kit): then a box icon in a stable tone. */
  visual: CategoryVisualId | null;
  fallbackKey?: string;
  size?: 'small' | 'large';
};

/** The category tile on cards, section headers and the rail (decorative: the name is always next to it). */
export const CategoryIcon: React.FC<CategoryIconProps> = ({ visual, fallbackKey = 'other', size = 'large' }) => {
  const entry = visual ? VISUALS[visual] : { icon: Box, tone: categoryTone(fallbackKey) };
  const Icon = entry.icon;
  return (
    <Tag
      color={entry.tone}
      className={size === 'large' ? styles.categoryIcon : styles.categoryIconSmall}
      aria-hidden='true'
      data-testid='library-category-icon'
      data-tone={entry.tone}
    >
      <Icon theme='outline' size={size === 'large' ? 18 : 12} fill='currentColor' />
    </Tag>
  );
};
