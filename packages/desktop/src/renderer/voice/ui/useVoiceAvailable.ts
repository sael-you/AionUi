/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { getVoiceController } from '../core/effects';
import type { VoiceController } from '../core/VoiceController';
import { useVoiceView } from '../core/voiceStore';

/**
 * Whether the voice entry points (orb, composer mic, `/voice`) should show: only
 * when voice is turned on in settings (off by default) or a device is already
 * armed. Settings are fetched at most once per page session; `/settings/voice`
 * stays the way to turn voice on.
 */
export function useVoiceAvailable(injected?: VoiceController): boolean {
  const controller = injected ?? getVoiceController();
  const view = useVoiceView(controller.store);
  useEffect(() => {
    void controller.ensureSettings();
  }, [controller]);
  return view.settings?.enabled === true || view.machine.mode !== 'off';
}
