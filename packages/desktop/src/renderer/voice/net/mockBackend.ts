/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scripted in-page voice backend for manual UI checks (development builds only) before the real
 * backend (C9 S1a/S1b) is deployed. Opt-in per browser only:
 *
 *   localStorage.setItem('aionui.voice.mock', '1'); location.reload();
 *
 * It replaces only the network side (REST, `/api/voice/ws`, the WebRTC call);
 * mic capture, wake word, earcons and clip playback stay real. It sends
 * nothing anywhere. Scenario per call: ready → captions → "checking" →
 * draft + read-back clip → Send (4 s hold) → sent → follow-up; Cancel works
 * at any point before sending.
 */

import { encodeWavPcm16 } from '@/renderer/services/speech/pcmRecorder';
import type { ClientFrame, ServerFrame, VoiceDraft, VoiceSettings } from '../core/types';
import { DEFAULT_VOICE_SETTINGS } from '../core/types';
import type { Effects, VoiceSocketLike } from '../core/effects';
import type { VoiceSocketListener } from './VoiceSocket';

export const VOICE_MOCK_STORAGE_KEY = 'aionui.voice.mock';

export function isVoiceMockEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(VOICE_MOCK_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** A 0.9 s two-tone WAV standing in for a synthesized read-back. */
function mockClip(): Promise<ArrayBuffer> {
  const rate = 24000;
  const pcm = new Int16Array(Math.round(rate * 0.9));
  for (let i = 0; i < pcm.length; i++) {
    const f = i < pcm.length / 2 ? 330 : 392;
    pcm[i] = Math.round(4000 * Math.sin((2 * Math.PI * f * i) / rate));
  }
  return encodeWavPcm16(new Uint8Array(pcm.buffer), rate, 1).arrayBuffer();
}

export function withMockBackend(fx: Effects): Effects {
  let settings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS, enabled: true, used_today_usd: 0.42 };
  let listener: VoiceSocketListener | null = null;
  let open = false;
  let sessionSeq = 0;
  let boundSession: string | null = null;
  let draft: VoiceDraft | null = null;
  const timers: unknown[] = [];
  const later = (ms: number, fn: () => void) => timers.push(fx.timers.setTimeout(fn, ms));
  const emit = (frame: ServerFrame) => open && listener?.onFrame(frame);
  const sid = () => boundSession;
  const setDraft = (patch: Partial<VoiceDraft>) => {
    if (!draft) return;
    draft = { ...draft, ...patch };
    emit({ name: 'voice.draftUpdated', voiceSessionId: sid(), ...draft });
  };

  const runScenario = (voiceSessionId: string) => {
    later(250, () => emit({ name: 'voice.ready', voiceSessionId, engine: 'openai-realtime', model: 'mock' }));
    later(900, () =>
      emit({ name: 'voice.caption', voiceSessionId, role: 'user', text: 'Ask the kanban', final: false })
    );
    later(1600, () =>
      emit({
        name: 'voice.caption',
        voiceSessionId,
        role: 'user',
        text: 'Ask the kanban build, uh, to rerun the tests',
        final: true,
      })
    );
    later(1700, () => emit({ name: 'voice.state', voiceSessionId, state: 'thinking', reason: 'checking' }));
    later(2600, () => {
      draft = {
        draftId: 'mock-draft',
        version: 1,
        state: 'drafted',
        target: { id: 'mock-conv', name: 'Kanban build', kind: 'conversation' },
        text: 'Rerun the unit tests and report failures.',
        diff: [
          { op: 'equal', text: 'Rerun the ' },
          { op: 'delete', text: 'uh, ', transform: 'filler' },
          { op: 'insert', text: 'unit ', transform: 'reference' },
          { op: 'equal', text: 'tests and report failures.' },
        ],
        delivery: 'new_turn',
        hash: 'mock-hash-1',
        options: [],
        spokenConfirm: true,
      };
      emit({ name: 'voice.draftUpdated', voiceSessionId, ...draft });
      emit({ name: 'voice.state', voiceSessionId, state: 'speaking', reason: 'readback' });
      emit({
        name: 'voice.readbackReady',
        voiceSessionId,
        draftId: 'mock-draft',
        version: 1,
        readbackId: 'mockrb1',
        url: '',
      });
      emit({
        name: 'voice.budget',
        voiceSessionId,
        usedUsd: 0.47,
        limitUsd: settings.daily_budget_usd,
        warning: null,
      });
    });
  };

  const onClientFrame = (frame: ClientFrame) => {
    if (frame.name === 'voice.playbackFinished') {
      emit({ name: 'voice.state', voiceSessionId: sid(), state: 'listening', reason: null });
    } else if (frame.name === 'voice.confirmTap' && draft && frame.hash === draft.hash) {
      setDraft({ state: 'committing' });
      later(4000, () => {
        if (draft?.state !== 'committing') return;
        setDraft({ state: 'sending' });
        later(400, () => {
          setDraft({ state: 'sent' });
          emit({
            name: 'voice.followUp',
            voiceSessionId: sid(),
            conversationId: 'mock-conv',
            status: 'sent',
            line: 'Kanban build has it.',
            clipId: null,
          });
        });
        later(3500, () =>
          emit({
            name: 'voice.followUp',
            voiceSessionId: null,
            conversationId: 'mock-conv',
            status: 'finished',
            line: 'Kanban build finished: 212 tests passed.',
            clipId: null,
          })
        );
      });
    } else if (frame.name === 'voice.cancelTap' && draft) {
      setDraft({ state: 'cancelled' });
    }
  };

  const socket: VoiceSocketLike = {
    start: () =>
      later(150, () => {
        open = true;
        listener?.onOpen();
      }),
    stop: () => {
      open = false;
      timers.splice(0).forEach((t) => fx.timers.clearTimeout(t));
    },
    send: (frame: ClientFrame) => {
      if (!open) return false;
      onClientFrame(frame);
      return true;
    },
    bindSession: (id: string | null) => {
      boundSession = id;
      if (id) runScenario(id);
    },
  };

  return {
    ...fx,
    api: {
      getSettings: async () => settings,
      putSettings: async (patch) => (settings = { ...settings, ...patch }),
      createSession: async () => {
        throw new Error('mock: sessions are created by startCall');
      },
      endSession: async () => {
        draft = null;
      },
      fetchClip: () => mockClip(),
    },
    createSocket: (l) => {
      listener = l;
      return socket;
    },
    startCall: async () => {
      await new Promise<void>((r) => fx.timers.setTimeout(() => r(), 300));
      sessionSeq++;
      return { voiceSessionId: `mock-${sessionSeq}`, engine: 'openai-realtime', model: 'mock', close: () => undefined };
    },
  };
}
