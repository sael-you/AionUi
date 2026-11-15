/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { runStateLabelKey, type RunState } from './runState';
import styles from './StatusGlyph.module.css';

export type StatusGlyphProps = {
  state: RunState;
  /** 12 (chips, pills), 14 (rows) or 16 (tree nodes, card rows). */
  size?: 12 | 14 | 16;
  /** Accessible name; defaults to the state's word. `null` hides the glyph from assistive tech. */
  label?: string | null;
  className?: string;
  'data-testid'?: string;
};

/**
 * The orchestration status glyph: one shape per state so colour is never the
 * only cue. Running is an open ring with a turning arc (a static ¾ arc with
 * reduced motion), needs you is filled with pause bars, done a check, failed a
 * cross, not started a dashed ring, stopped a ring with a square. Idle renders
 * nothing.
 */
const StatusGlyph: React.FC<StatusGlyphProps> = ({ state, size = 16, label, className, ...rest }) => {
  const { t } = useTranslation();
  if (state === 'idle') return null;
  const name = label === undefined ? t(runStateLabelKey(state)) : label;
  return (
    <svg
      className={classNames(styles.glyph, styles[state], className)}
      width={size}
      height={size}
      viewBox='0 0 16 16'
      role={name ? 'img' : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : true}
      data-run-state={state}
      data-testid={rest['data-testid']}
    >
      {name && <title>{name}</title>}
      {state === 'running' && (
        <>
          <circle className={styles.track} cx='8' cy='8' r='5.5' />
          <path className={classNames(styles.arc, styles.arcMoving)} d='M8 2.5a5.5 5.5 0 0 1 5.5 5.5' />
          <path className={classNames(styles.arc, styles.arcStatic)} d='M8 2.5a5.5 5.5 0 1 1 -5.5 5.5' />
        </>
      )}
      {state === 'waiting' && (
        <>
          <circle className={styles.disc} cx='8' cy='8' r='6.25' />
          <rect className={styles.mark} x='5.9' y='5.2' width='1.5' height='5.6' rx='.6' />
          <rect className={styles.mark} x='8.6' y='5.2' width='1.5' height='5.6' rx='.6' />
        </>
      )}
      {state === 'done' && (
        <>
          <circle className={styles.disc} cx='8' cy='8' r='6.25' />
          <path className={styles.stroke} d='m5.3 8.1 1.8 1.8 3.6-3.7' />
        </>
      )}
      {state === 'failed' && (
        <>
          <circle className={styles.disc} cx='8' cy='8' r='6.25' />
          <path className={styles.stroke} d='m5.7 5.7 4.6 4.6M10.3 5.7l-4.6 4.6' />
        </>
      )}
      {state === 'queued' && <circle className={styles.dashed} cx='8' cy='8' r='5.5' />}
      {state === 'stopped' && (
        <>
          <circle className={styles.ring} cx='8' cy='8' r='5.5' />
          <rect className={styles.square} x='5.9' y='5.9' width='4.2' height='4.2' rx='.8' />
        </>
      )}
    </svg>
  );
};

export default StatusGlyph;
