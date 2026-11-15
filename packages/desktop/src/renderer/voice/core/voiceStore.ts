/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * View state of voice mode: a tiny external store (subscribe / getSnapshot)
 * consumed with `useSyncExternalStore`, so the orb, overlay, composer mic and
 * settings panel share one controller without a React provider in the tree.
 */

import { useSyncExternalStore } from 'react';
import { INITIAL_VOICE_STATE, orbStateOf, type VoiceMachineState } from './stateMachine';
import type { OrbState, VoiceBudget, VoiceCaption, VoiceDraft, VoiceFollowUp, VoiceSettings } from './types';

export const MAX_CAPTIONS = 30;
export const MAX_FOLLOW_UPS = 5;

export type WakeWordStatus = 'off' | 'loading' | 'ready' | 'unavailable';

/** Last pre-roll replay (S2 gate: "no lost first words"): lag at wake, catch-up time, jump. */
export type PrerollStats = { lagSec: number; catchupSec: number | null; jumped: boolean; droppedSec: number };

export type VoiceNotice = { code: string; message?: string } | null;

export type VoiceView = {
  machine: VoiceMachineState;
  orb: OrbState;
  captions: VoiceCaption[];
  draft: VoiceDraft | null;
  /** Wall-clock end of the 4 s hold while a draft is `committing` (display only). */
  holdUntil: number | null;
  readbackPlaying: boolean;
  /** A Send / Cancel tap for the current draft version is on its way (blocks duplicate taps). */
  draftTap: 'confirm' | 'cancel' | null;
  /** Last line Jarvis said about the current draft (e.g. a refused spoken "send"). */
  draftHint: string | null;
  /** The current call only captures the answer to an agent's question (closes after it). */
  asking: boolean;
  followUps: VoiceFollowUp[];
  budget: VoiceBudget | null;
  notice: VoiceNotice;
  settings: VoiceSettings | null;
  wakeWord: WakeWordStatus;
  screenMaySleep: boolean;
  systemPaused: boolean;
  overlayOpen: boolean;
  settingsOpen: boolean;
  focusConversationId: string | null;
  preroll: PrerollStats | null;
};

export const INITIAL_VIEW: VoiceView = {
  machine: INITIAL_VOICE_STATE,
  orb: 'off',
  captions: [],
  draft: null,
  holdUntil: null,
  readbackPlaying: false,
  draftTap: null,
  draftHint: null,
  asking: false,
  followUps: [],
  budget: null,
  notice: null,
  settings: null,
  wakeWord: 'off',
  screenMaySleep: false,
  systemPaused: false,
  overlayOpen: false,
  settingsOpen: false,
  focusConversationId: null,
  preroll: null,
};

export class VoiceStore {
  private view: VoiceView = INITIAL_VIEW;
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): VoiceView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(patch: Partial<VoiceView> | ((view: VoiceView) => Partial<VoiceView>)): void {
    const next = { ...this.view, ...(typeof patch === 'function' ? patch(this.view) : patch) };
    next.orb = orbStateOf(next.machine);
    this.view = next;
    this.listeners.forEach((l) => l());
  }
}

/** Subscribe a component to the voice view. */
export function useVoiceView(store: VoiceStore): VoiceView {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
