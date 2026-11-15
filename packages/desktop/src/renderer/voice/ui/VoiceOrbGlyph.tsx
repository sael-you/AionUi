/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { OrbState } from '../core/types';
import styles from './voice.module.css';

/** Decorative orb; the accessible state label lives on the owning control. */
const VoiceOrbGlyph: React.FC<{ state: OrbState; size?: number }> = ({ state, size }) => (
  <span
    className={styles.orb}
    data-state={state}
    aria-hidden='true'
    style={size ? ({ '--voice-orb-size': `${size}px` } as React.CSSProperties) : undefined}
  >
    <span className={styles.orbRing} />
    <span className={styles.orbCore} />
  </span>
);

export default VoiceOrbGlyph;
