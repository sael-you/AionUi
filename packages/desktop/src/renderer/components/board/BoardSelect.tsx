/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Select, type SelectProps } from '@arco-design/web-react';
import type { SelectHandle } from '@arco-design/web-react/es/Select/interface';
import React, { useEffect, useRef } from 'react';

/**
 * Arco `Select` with an accessible name. Arco renders the `role="combobox"`
 * element itself and does not forward `aria-label`, so the name is set on that
 * element after mount (and whenever the label changes).
 */
export const BoardSelect: React.FC<SelectProps & { ariaLabel: string }> = ({ ariaLabel, ...props }) => {
  const ref = useRef<SelectHandle>(null);
  useEffect(() => {
    ref.current?.dom?.setAttribute('aria-label', ariaLabel);
  });
  return <Select ref={ref} {...props} />;
};
