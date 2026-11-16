/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** The part of Bun's API the build script uses (bun-types is not a dependency of this repo). */
declare const Bun: {
  build(options: {
    entrypoints: string[];
    outdir: string;
    target: 'browser';
    format: 'esm';
    minify: boolean;
    naming: string;
    define: Record<string, string>;
  }): Promise<{ success: boolean; logs: unknown[] }>;
};
