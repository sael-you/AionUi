/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A browser profile as the owner named it (TASK-124): its colour dot (project
 * palette, theme-aware), its emoji and its name. Used by the panel's profile
 * switcher and by Settings → Browser.
 */

import React from 'react';
import type { BrowserInstanceSettings } from '@/common/types/platform/serverBrowser';
import { PROJECT_COLORS, projectAccent } from '@/renderer/components/workspace/ProjectIdentity/projectColors';
import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';

type Profile = Pick<BrowserInstanceSettings, 'name' | 'color' | 'emoji'>;

/** The theme accent of a palette id, or `null` (no colour / unknown id). */
export const useProfileAccent = (color: string | undefined): string | null => {
  const { theme } = useThemeContext();
  const entry = color ? PROJECT_COLORS.find((candidate) => candidate.id === color) : undefined;
  return entry ? projectAccent(entry, theme) : null;
};

const BrowserProfileLabel: React.FC<{ profile: Profile; className?: string }> = ({ profile, className }) => {
  const accent = useProfileAccent(profile.color);
  return (
    <span className={`inline-flex items-center gap-6px min-w-0 ${className ?? ''}`} data-testid='browser-profile-label'>
      <span
        className='inline-block size-8px rd-full flex-shrink-0 border border-solid border-3'
        style={accent ? { background: accent, borderColor: accent } : undefined}
        aria-hidden
      />
      {profile.emoji ? (
        <span className='flex-shrink-0' aria-hidden>
          {profile.emoji}
        </span>
      ) : null}
      <span className='truncate'>{profile.name}</span>
    </span>
  );
};

export default BrowserProfileLabel;
