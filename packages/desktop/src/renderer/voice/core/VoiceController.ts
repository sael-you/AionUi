/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * VoiceController — orchestrates voice mode in the browser (plan §1, §3.6, §3.8).
 *
 * The pure state machine (stateMachine.ts) decides; this class performs the
 * effects: capture graph, wake-word worker, `/api/voice/ws`, the WebRTC call,
 * earcons, clip playback, Wake Lock, Media Session and page lifecycle.
 *
 * Invariants enforced here:
 * - the AudioContext and the `<audio>` element are created synchronously in
 *   the arm gesture (autoplay policy);
 * - outgoing audio is muted (worklet silence) whenever `isOutgoingLive` is
 *   false — socket loss mutes at once, only `voice.ready` unmutes;
 * - `/api/voice/ws` down for 20 s during a call → hang up ("offline");
 * - ICE `disconnected` > 3 s / `failed` → hang up and resume with `resume_of`;
 * - page `freeze` → `voice.frozen`, call dropped; `resume` → silent re-arm;
 * - confirmation is only ever a tap carrying the draft hash, or the backend's
 *   own evidence from `voice.playbackFinished` + `voice.speechOnset`;
 * - an agent `ask` with no live call opens a short call only to capture the
 *   answer (question → answer → close, at most 2 min, PLAN §3.4).
 */

import type { Effects } from './effects';
import {
  INITIAL_VOICE_STATE,
  decideNextMute,
  isOutgoingLive,
  reduceVoice,
  type VoiceEvent,
  type VoiceMachineState,
} from './stateMachine';
import {
  CANCELLABLE_DRAFT_STATES,
  CONFIRMABLE_DRAFT_STATES,
  TERMINAL_DRAFT_STATES,
  type CaptionRole,
  type FollowUpStatus,
  type ServerFrame,
  type ServerVoiceState,
  type VoiceSettings,
} from './types';
import { callEndPolicy } from './endReasons';
import { MAX_CAPTIONS, MAX_FOLLOW_UPS, VoiceStore } from './voiceStore';
import { outputLatencyOf } from '../audio/clipPlayer';
import type { EarconName } from '../audio/earcons';
import type { SendModeEvent } from '../capture/sendWorklet';
import type { RealtimeCall } from '../engine/openaiRealtime';
import { VoiceBusyError, voiceErrorCode } from '../net/voiceApi';

export const SOCKET_DEAD_MAN_MS = 20_000;
export const READY_TIMEOUT_MS = 10_000;
export const DRAFT_LINGER_MS = 6_000;
export const HOLD_MS = 4_000;
const RESUME_RETRY_MS = 1_500;
const MAX_RESUME_ATTEMPTS = 3;
const SETTINGS_RETRY_MS = 5 * 60_000;
/** An answer-only call for an agent `ask` closes after this long at the latest (PLAN §3.4). */
export const ASK_CALL_MAX_MS = 120_000;
/** Grace after the answer's final transcript before the answer-only call hangs up. */
export const ASK_HANGUP_DELAY_MS = 1_500;
const MAX_SEEN_CLIPS = 32;
/** `voice.state armed` reasons an older backend used to signal a hang-up. */
const LEGACY_END_REASONS: ReadonlySet<string> = new Set(['idle', 'budget', 'rotation', 'kill', 'ended']);
/**
 * Frames about the bound call; frames of another session are stale. Drafts, clips, follow-ups,
 * wakes, budget and errors are per user and may name an earlier session (e.g. a draft sent by
 * the backend worker after a resume).
 */
const CALL_SCOPED_FRAMES: ReadonlySet<ServerFrame['name']> = new Set([
  'voice.ready',
  'voice.state',
  'voice.caption',
  'voice.assistantAudioFinished',
]);
/** Lines Jarvis says about the current draft: never held back by a pending confirmation. */
const DRAFT_LINE_STATUSES: ReadonlySet<FollowUpStatus> = new Set([
  'sent',
  'queued',
  'saved_not_started',
  'expired',
  'interrupted',
  'confirm_rejected',
]);
const NEEDS_YOU_STATUSES: ReadonlySet<FollowUpStatus> = new Set([
  'failed',
  'needs_approval',
  'saved_not_started',
  'expired',
  'interrupted',
]);

type QueuedClip = { clipId: string; urlOrId: string; tone: EarconName | null; draftLine: boolean };

export type ArmOptions = { focusConversationId?: string | null };

export class VoiceController {
  readonly store = new VoiceStore();
  private machine: VoiceMachineState = INITIAL_VOICE_STATE;
  private ctx: AudioContext | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private capture: Awaited<ReturnType<Effects['openCapture']>> | null = null;
  private socket: ReturnType<Effects['createSocket']> | null = null;
  private clips: ReturnType<Effects['createClipPlayer']> | null = null;
  private call: RealtimeCall | null = null;
  private wakeT: number | null = null;
  private readbackPending = 0;
  private playingKind: 'readback' | 'followUp' | null = null;
  private followUpBusy = false;
  private followUpQueue: QueuedClip[] = [];
  /** Clip ids already queued or played (a `voice.wake` repeats the follow-up's clip id). */
  private seenClips: string[] = [];
  /** Clip of an agent question that arrived without a live call: its end opens the answer call. */
  private askClipId: string | null = null;
  private askTimer: unknown = null;
  private askHangupTimer: unknown = null;
  private pendingPreroll: number | null = null;
  private everReady = false;
  private wakeEnabled = true;
  private deadManTimer: unknown = null;
  private readyTimer: unknown = null;
  private draftTimer: unknown = null;
  private resumeTimer: unknown = null;
  private resumeAttempts = 0;
  private reconnectingToned = false;
  private unregisterMedia: (() => void) | null = null;
  private removeLifecycle: (() => void) | null = null;
  private captionSeq = 0;
  private followUpSeq = 0;
  private armToken = 0;
  private settingsPromise: Promise<VoiceSettings | null> | null = null;
  private settingsFailedAt: number | null = null;

  constructor(private readonly fx: Effects) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get state(): VoiceMachineState {
    return this.machine;
  }

  /** Orb tap / shortcut / `/voice`: arm when off, disarm otherwise. Must run inside the gesture. */
  toggle(options: ArmOptions = {}): void {
    if (this.machine.mode === 'off') this.arm(options);
    else this.disarm('tap');
  }

  /** Arm voice mode. Synchronous part runs in the user gesture. */
  arm(options: ArmOptions = {}): void {
    if (this.machine.mode !== 'off') return;
    const settings = this.store.getSnapshot().settings;
    if (settings && !settings.enabled) {
      this.store.update({ overlayOpen: true, notice: { code: 'disabled' } });
      return;
    }
    // Autoplay policy: context + output element created synchronously in the tap.
    let ctx: AudioContext;
    try {
      ctx = this.fx.createAudioContext();
    } catch {
      this.store.update({ overlayOpen: true, notice: { code: 'audioUnavailable' } });
      return;
    }
    this.ctx = ctx;
    void ctx.resume().catch((): undefined => undefined);
    this.audioEl = this.fx.createAudioElement();
    this.clips = this.fx.createClipPlayer(ctx);
    void this.fx.wakeLock.acquire().then((ok) => this.store.update({ screenMaySleep: !ok }));
    const token = ++this.armToken;
    this.dispatch({ type: 'arm' });
    this.store.update({
      overlayOpen: true,
      notice: null,
      focusConversationId: options.focusConversationId ?? null,
      captions: [],
      draft: null,
      holdUntil: null,
    });
    void this.finishArm(token);
  }

  disarm(reason: string): void {
    if (this.machine.mode === 'off') return;
    this.armToken++;
    const ctx = this.ctx;
    if (ctx && reason !== 'error') this.earcon('bye');
    this.endCall('disarm', true);
    this.clips?.stop();
    this.followUpQueue = [];
    this.followUpBusy = false;
    this.seenClips = [];
    this.askClipId = null;
    this.capture?.stop();
    this.capture = null;
    this.fx.wakeWord.detach();
    this.socket?.stop();
    this.socket = null;
    this.fx.wakeLock.release();
    this.removeLifecycle?.();
    this.removeLifecycle = null;
    this.clearTimer('deadManTimer');
    this.clearTimer('resumeTimer');
    this.clearTimer('draftTimer');
    if (this.audioEl) this.audioEl.srcObject = null;
    this.audioEl = null;
    this.clips = null;
    this.ctx = null;
    if (ctx) this.fx.timers.setTimeout(() => void ctx.close().catch((): undefined => undefined), 600);
    this.dispatch({ type: 'disarm' });
    this.store.update({
      draft: null,
      holdUntil: null,
      readbackPlaying: false,
      draftTap: null,
      draftHint: null,
      wakeWord: 'off',
      screenMaySleep: false,
      systemPaused: false,
      focusConversationId: null,
    });
  }

  /** Tap-to-talk: start a provider call without the wake word. */
  talk(): void {
    if (this.machine.mode === 'off') {
      this.arm();
      return;
    }
    if (this.ctx) void this.ctx.resume().catch((): undefined => undefined);
    this.wake(this.ctx?.currentTime ?? 0);
  }

  /** End the provider call, stay armed. */
  hangUp(): void {
    if (!this.machine.call) return;
    this.endCall('user', true);
  }

  toggleMute(): void {
    if (!this.machine.call) return;
    this.dispatch({ type: 'userMute', muted: !this.machine.userMuted });
  }

  /**
   * Send tap: one `voice.confirmTap` per draft version and state (a second tap before the
   * backend answers is dropped; the backend's CAS would refuse it anyway).
   */
  confirmDraft(): void {
    const { draft, draftTap } = this.store.getSnapshot();
    if (!draft || !CONFIRMABLE_DRAFT_STATES.has(draft.state) || draftTap) return;
    if (!draft.hash) {
      this.store.update({ notice: { code: 'cannotConfirm' } });
      return;
    }
    const sent = this.socket?.send({
      name: 'voice.confirmTap',
      draftId: draft.draftId,
      version: draft.version,
      hash: draft.hash,
    });
    this.store.update(sent ? { draftTap: 'confirm' } : { notice: { code: 'offline' } });
  }

  /** Cancel tap: wins over a pending Send tap; sent once per draft version and state. */
  cancelDraft(): void {
    const { draft, draftTap } = this.store.getSnapshot();
    if (!draft || !CANCELLABLE_DRAFT_STATES.has(draft.state) || draftTap === 'cancel') return;
    if (this.playingKind === 'readback') this.clips?.stop();
    const sent = this.socket?.send({
      name: 'voice.cancelTap',
      draftId: draft.draftId,
      version: draft.version,
      hash: draft.hash ?? '',
    });
    this.store.update(sent ? { draftTap: 'cancel' } : { notice: { code: 'offline' } });
  }

  setOverlayOpen(open: boolean): void {
    this.store.update({ overlayOpen: open, ...(open ? {} : { settingsOpen: false }) });
  }

  setSettingsOpen(open: boolean): void {
    this.store.update({ settingsOpen: open, ...(open ? { overlayOpen: true } : {}) });
    if (open) void this.loadSettings();
  }

  dismissNotice(): void {
    this.store.update({ notice: null });
  }

  /** Fetch the settings now (settings page, arm without a cached value). */
  async loadSettings(): Promise<VoiceSettings | null> {
    try {
      const settings = await this.fx.api.getSettings();
      this.store.update({ settings });
      return settings;
    } catch {
      this.settingsFailedAt = this.fx.timers.now();
      return this.store.getSnapshot().settings;
    }
  }

  /**
   * Settings for page chrome (orb, composer mic, /voice): fetched at most once per page
   * session; a failed fetch (e.g. backend without voice) is retried after 5 minutes.
   */
  ensureSettings(): Promise<VoiceSettings | null> {
    const cached = this.store.getSnapshot().settings;
    if (cached) return Promise.resolve(cached);
    if (this.settingsPromise) return this.settingsPromise;
    if (this.settingsFailedAt !== null && this.fx.timers.now() - this.settingsFailedAt < SETTINGS_RETRY_MS) {
      return Promise.resolve(null);
    }
    this.settingsPromise = this.loadSettings().finally(() => {
      this.settingsPromise = null;
    });
    return this.settingsPromise;
  }

  async saveSettings(patch: Partial<VoiceSettings>): Promise<boolean> {
    try {
      const settings = await this.fx.api.putSettings(patch);
      this.store.update({ settings });
      if (!settings.enabled && this.machine.mode !== 'off') this.disarm('disabled');
      return true;
    } catch (error) {
      this.store.update({ notice: { code: voiceErrorCode(error) } });
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Arm / disarm internals
  // -------------------------------------------------------------------------

  private async finishArm(token: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const settings =
        this.store.getSnapshot().settings ?? (await this.ensureSettings()) ?? (await this.loadSettings());
      if (token !== this.armToken) return;
      if (settings && !settings.enabled) {
        this.disarm('error');
        this.store.update({ notice: { code: 'disabled' }, overlayOpen: true });
        return;
      }
      this.wakeEnabled = settings?.wake_word_enabled !== false;
      const capture = await this.fx.openCapture(ctx, {
        onTrackEnded: () => this.onTrackEnded(),
        onSendMode: (event) => this.onSendMode(event),
      });
      if (token !== this.armToken) {
        capture.stop();
        return;
      }
      this.capture = capture;
      capture.mute();
      this.store.update({ wakeWord: this.wakeEnabled ? 'loading' : 'off' });
      this.fx.wakeWord.start(
        capture.takeWakePort(),
        this.fx.assetBase(),
        {
          onLoaded: () => this.store.update({ wakeWord: this.wakeEnabled ? 'ready' : 'off' }),
          onWake: (t) => this.wake(t),
          onVad: (speech, t) => this.onVad(speech, t),
          onError: () => this.store.update({ wakeWord: this.wakeEnabled ? 'unavailable' : 'off' }),
        },
        { loadModels: this.wakeEnabled }
      );
      this.socket = this.fx.createSocket({
        onOpen: () => this.onSocketOpen(),
        onClose: () => this.onSocketClose(),
        onFrame: (frame) => this.onFrame(frame),
      });
      this.dispatch({ type: 'socketConnecting' });
      this.socket.start();
      const onState = () => this.onContextState();
      ctx.addEventListener('statechange', onState);
      const removePage = this.fx.lifecycle({
        onVisible: () => this.onVisible(),
        onFreeze: () => this.onFreeze(),
        onResume: () => this.onResume(),
        onOnline: () => this.scheduleResume(0),
      });
      this.removeLifecycle = () => {
        removePage();
        ctx.removeEventListener('statechange', onState);
      };
      this.dispatch({ type: 'armed' });
      this.earcon('armed');
      this.fx.vibrate(30);
    } catch (error) {
      if (token !== this.armToken) return;
      const name = (error as { name?: string })?.name;
      this.disarm('error');
      this.store.update({
        overlayOpen: true,
        notice: { code: name === 'NotAllowedError' || name === 'SecurityError' ? 'micDenied' : 'armFailed' },
      });
    }
  }

  private onSendMode(event: SendModeEvent): void {
    if (event.mode === 'catchup') {
      this.store.update({ preroll: { lagSec: event.lagSec, catchupSec: null, jumped: false, droppedSec: 0 } });
    } else if (event.mode === 'live' && event.catchupSec > 0) {
      this.store.update((view) => ({
        preroll: {
          lagSec: view.preroll?.lagSec ?? 0,
          catchupSec: event.catchupSec,
          jumped: event.jumped,
          droppedSec: event.jumped ? event.lagSec : 0,
        },
      }));
    }
  }

  private onTrackEnded(): void {
    if (this.machine.mode === 'off') return;
    this.disarm('error');
    this.store.update({ notice: { code: 'micLost' }, overlayOpen: true });
  }

  // -------------------------------------------------------------------------
  // Calls
  // -------------------------------------------------------------------------

  private wake(t: number, resumeOf?: string): void {
    if (this.machine.mode !== 'armed' || this.machine.call || !this.capture || !this.audioEl) return;
    if (this.machine.socket !== 'open') {
      this.store.update({ notice: { code: 'offline' } });
      return;
    }
    this.dispatch({ type: 'wake' });
    this.wakeT = resumeOf ? null : t;
    this.everReady = false;
    this.fx.wakeWord.setMode('vad');
    this.store.update({ overlayOpen: true, notice: null });
    this.fx.vibrate(40);
    const token = this.armToken;
    const capture = this.capture;
    const focus = this.store.getSnapshot().focusConversationId;
    void this.fx
      .startCall({
        outgoingTrack: capture.outgoingTrack,
        audioElement: this.audioEl,
        focusConversationId: focus ?? undefined,
        resumeOf,
        onNetworkLost: () => this.onNetworkLost(),
      })
      .then((call) => {
        if (token !== this.armToken || !this.machine.call || this.machine.call.phase !== 'connecting') {
          call.close();
          void this.fx.api.endSession(call.voiceSessionId, 'cancelled').catch((): undefined => undefined);
          return;
        }
        this.call = call;
        this.resumeAttempts = 0;
        this.dispatch({ type: 'sessionCreated', voiceSessionId: call.voiceSessionId });
        this.socket?.bindSession(call.voiceSessionId);
        this.readyTimer = this.fx.timers.setTimeout(() => {
          this.readyTimer = null;
          if (this.machine.call && this.machine.call.phase !== 'ready' && this.machine.socket === 'open') {
            this.endCall('ready_timeout', true);
            this.store.update({ notice: { code: 'callFailed' } });
          }
        }, READY_TIMEOUT_MS);
        this.unregisterMedia = this.fx.registerMediaSession({
          hangup: () => this.hangUp(),
          toggleMic: () => this.toggleMute(),
          stop: () => this.disarm('media'),
        });
      })
      .catch((error: unknown) => {
        if (token !== this.armToken) return;
        this.dispatch({ type: 'callEnded', resumeOf: null });
        this.restoreWakeMode();
        if (error instanceof VoiceBusyError) {
          this.earcon('otherDevice');
          this.store.update({ notice: { code: 'busy' } });
          return;
        }
        const code = voiceErrorCode(error);
        if (resumeOf && code === 'network') {
          this.dispatch({ type: 'callEnded', resumeOf });
          this.scheduleResume(RESUME_RETRY_MS);
          return;
        }
        this.store.update({ notice: { code: code === 'network' ? 'callFailed' : code } });
      });
  }

  /** Close the call locally; optionally tell the backend to hang up the provider call. */
  private endCall(reason: string, notifyBackend: boolean, resumeOf: string | null = null): void {
    const call = this.call;
    this.call = null;
    this.clearTimer('readyTimer');
    this.clearTimer('deadManTimer');
    this.clearTimer('askTimer');
    this.clearTimer('askHangupTimer');
    if (this.store.getSnapshot().asking) this.store.update({ asking: false });
    this.unregisterMedia?.();
    this.unregisterMedia = null;
    this.capture?.mute();
    if (call) {
      call.close();
      if (notifyBackend) void this.fx.api.endSession(call.voiceSessionId, reason).catch((): undefined => undefined);
    }
    this.socket?.bindSession(null);
    if (this.machine.call) this.dispatch({ type: 'callEnded', resumeOf });
    this.restoreWakeMode();
  }

  private restoreWakeMode(): void {
    if (this.machine.mode === 'armed') this.fx.wakeWord.setMode(this.wakeEnabled ? 'wake' : 'vad');
  }

  private onNetworkLost(): void {
    const id = this.call?.voiceSessionId ?? null;
    this.endCall('network', true, id);
    this.store.update({ notice: { code: 'networkLost' } });
    this.scheduleResume(RESUME_RETRY_MS);
  }

  private scheduleResume(delayMs: number): void {
    if (!this.machine.resumeOf || this.resumeTimer) return;
    this.resumeTimer = this.fx.timers.setTimeout(() => {
      this.resumeTimer = null;
      const resumeOf = this.machine.resumeOf;
      if (!resumeOf || this.machine.call || this.machine.mode !== 'armed') return;
      if (this.machine.socket !== 'open' || !this.fx.isOnline()) return; // retried on socket open / online
      if (++this.resumeAttempts > MAX_RESUME_ATTEMPTS) {
        this.dispatch({ type: 'resumeConsumed' });
        return;
      }
      this.dispatch({ type: 'resumeConsumed' });
      this.wake(this.ctx?.currentTime ?? 0, resumeOf);
    }, delayMs);
  }

  // -------------------------------------------------------------------------
  // Socket
  // -------------------------------------------------------------------------

  private onSocketOpen(): void {
    this.dispatch({ type: 'socketOpen' });
    // The dead-man timer keeps running: only `voice.ready` proves the call is back.
    this.scheduleResume(0);
  }

  private onSocketClose(): void {
    if (this.machine.mode === 'off') return;
    const hadCall = Boolean(this.machine.call);
    this.dispatch({ type: 'socketClosed' });
    if (!hadCall) return;
    if (!this.reconnectingToned) {
      this.reconnectingToned = true;
      this.earcon('reconnecting');
    }
    this.startDeadMan('socket_lost');
  }

  /**
   * Hang up if the call does not become ready again within 20 s (§3.6 step 4).
   * Cleared only by `voice.ready` (or when the call ends).
   */
  private startDeadMan(reason: string): void {
    if (this.deadManTimer) return;
    this.deadManTimer = this.fx.timers.setTimeout(() => {
      this.deadManTimer = null;
      if (this.machine.call && this.machine.call.phase !== 'ready') {
        this.endCall(reason, true);
        this.store.update({ notice: { code: 'offline' } });
      }
    }, SOCKET_DEAD_MAN_MS);
  }

  private onFrame(frame: ServerFrame): void {
    const boundId = this.machine.call?.voiceSessionId ?? null;
    if (frame.voiceSessionId && boundId && frame.voiceSessionId !== boundId && CALL_SCOPED_FRAMES.has(frame.name))
      return;
    switch (frame.name) {
      case 'voice.ready':
        return this.onReady(frame.voiceSessionId);
      case 'voice.state':
        return this.onServerState(frame.state, frame.reason);
      case 'voice.callEnded':
        return this.onCallEnded(frame.voiceSessionId, frame.reason);
      case 'voice.caption':
        return this.addCaption(frame.role, frame.text, frame.final);
      case 'voice.draftUpdated':
        return this.onDraft(frame);
      case 'voice.readbackReady':
        return this.onReadback(frame.draftId, frame.version, frame.readbackId, frame.url);
      case 'voice.assistantAudioFinished': {
        const latencyMs = this.ctx ? outputLatencyOf(this.ctx) * 1000 : 0;
        this.fx.timers.setTimeout(() => this.earcon('yourTurn'), latencyMs);
        return;
      }
      case 'voice.wake':
        return this.onWake(frame.reason, frame.itemId);
      case 'voice.followUp':
        return this.onFollowUp(frame);
      case 'voice.budget':
        this.store.update({
          budget: { usedUsd: frame.usedUsd, limitUsd: frame.limitUsd, warning: frame.warning },
          ...(frame.warning === '100' ? { notice: { code: 'budget' } } : {}),
        });
        return;
      case 'voice.error':
        if (/disabled|kill/i.test(frame.code)) {
          this.disarm('error');
          this.store.update({ notice: { code: 'disabled' }, overlayOpen: true });
          return;
        }
        if (frame.code === 'AUTH_EXPIRED') {
          this.store.update({ notice: { code: 'unauthorized' }, overlayOpen: true });
          return;
        }
        if (frame.code === 'RATE_LIMITED') {
          this.store.update({ notice: { code: 'rateLimited' } });
          return;
        }
        this.store.update({ notice: { code: 'server', message: frame.message } });
        return;
      default:
        return;
    }
  }

  private onReady(voiceSessionId: string): void {
    if (!this.machine.call || this.machine.call.voiceSessionId !== voiceSessionId) return;
    const first = !this.everReady;
    // First ready after a wake replays the ring buffer from the wake moment.
    this.pendingPreroll = first && this.wakeT !== null ? this.wakeT : null;
    this.dispatch({ type: 'ready', voiceSessionId });
    this.pendingPreroll = null;
    if (this.machine.call?.phase !== 'ready') return;
    this.clearTimer('readyTimer');
    this.clearTimer('deadManTimer');
    this.everReady = true;
    this.reconnectingToned = false;
    this.earcon(first ? 'listening' : 'back');
  }

  /**
   * The only frame that ends a call from the backend side. Sleep and the kill switch disarm;
   * rotation re-dials at once with `resume_of`; the other reasons stay armed with a notice.
   */
  private onCallEnded(voiceSessionId: string | null, reason: string): void {
    const policy = callEndPolicy(reason);
    if (policy.disarm) {
      this.disarm(reason === 'sleep' ? 'sleep' : 'error');
      if (policy.notice) this.store.update({ notice: { code: policy.notice }, overlayOpen: true });
      return;
    }
    const call = this.machine.call;
    if (!call || (voiceSessionId && call.voiceSessionId && voiceSessionId !== call.voiceSessionId)) return;
    const resumeOf = policy.redial ? call.voiceSessionId : null;
    this.endCall(reason || 'server', false, resumeOf);
    if (policy.notice) this.store.update({ notice: { code: policy.notice } });
    if (resumeOf) this.scheduleResume(0);
  }

  private onServerState(state: ServerVoiceState, reason: string | null): void {
    if (reason === 'sleep') {
      this.disarm('sleep');
      return;
    }
    const call = this.machine.call;
    if (!call) return;
    if (state === 'offline') {
      // Sideband re-attach in progress (reason `reconnecting`): mute, wait for `voice.ready`.
      this.dispatch({ type: 'callSuspended' });
      this.startDeadMan('offline');
      return;
    }
    if (state === 'armed') {
      // `armed` with no reason is the backend answering a hello before the call is ready —
      // never a hang-up. Calls end only on `voice.callEnded`; an older backend that ends a
      // ready call with `armed` + an explicit reason is still honoured.
      if (call.phase === 'ready' && reason && LEGACY_END_REASONS.has(reason)) this.onCallEnded(null, reason);
      return;
    }
    const prev = call.serverState;
    this.dispatch({ type: 'serverState', state });
    if (prev === 'listening' && state === 'thinking') this.earcon('gotIt');
    if (state === 'thinking' && reason && /check|tool|ground/i.test(reason)) this.earcon('working');
  }

  // -------------------------------------------------------------------------
  // Captions, drafts, clips, follow-ups
  // -------------------------------------------------------------------------

  private addCaption(role: CaptionRole, text: string, final: boolean): void {
    // The answer to an agent's question is the first final user transcript of the answer call.
    if (role === 'user' && final && text.trim() && this.store.getSnapshot().asking && !this.askHangupTimer) {
      this.askHangupTimer = this.fx.timers.setTimeout(() => {
        this.askHangupTimer = null;
        if (this.store.getSnapshot().asking) this.hangUp();
      }, ASK_HANGUP_DELAY_MS);
    }
    this.store.update((view) => {
      const captions = view.captions.slice();
      const last = captions[captions.length - 1];
      if (last && !last.final && last.role === role) captions[captions.length - 1] = { ...last, text, final };
      else captions.push({ id: ++this.captionSeq, role, text, final });
      return { captions: captions.slice(-MAX_CAPTIONS) };
    });
  }

  private onDraft(frame: ServerFrame & { name: 'voice.draftUpdated' }): void {
    const current = this.store.getSnapshot().draft;
    if (current && current.draftId === frame.draftId && frame.version < current.version) return; // stale
    const { name: _name, voiceSessionId: _sid, ...draft } = frame;
    const changedVersion = !current || current.draftId !== draft.draftId || current.version !== draft.version;
    if (changedVersion && this.playingKind === 'readback') this.clips?.stop();
    const prevState = current && !changedVersion ? current.state : null;
    const changed = prevState !== draft.state;
    this.store.update({
      draft,
      ...(changedVersion ? { overlayOpen: true, draftHint: null } : {}),
      // A new version or state answers the pending tap.
      ...(changed ? { draftTap: null } : {}),
      holdUntil: this.holdDeadline(draft, prevState),
    });
    if (!changed) return;
    this.clearTimer('draftTimer');
    this.flushFollowUps();
    if (draft.state === 'sent') {
      this.earcon('sent');
      this.fx.vibrate([30, 40, 30]);
    } else if (draft.state === 'failed' || draft.state === 'saved_not_started') {
      this.earcon('needsYou');
    }
    if ((draft.state === 'superseded' || draft.state === 'cancelled') && this.playingKind === 'readback')
      this.clips?.stop();
    if (TERMINAL_DRAFT_STATES.has(draft.state)) {
      this.draftTimer = this.fx.timers.setTimeout(() => {
        this.draftTimer = null;
        const d = this.store.getSnapshot().draft;
        if (d && d.draftId === draft.draftId && d.version === draft.version)
          this.store.update({ draft: null, holdUntil: null, draftTap: null, draftHint: null });
        this.flushFollowUps();
      }, DRAFT_LINGER_MS);
    }
  }

  /**
   * Display deadline of the 4 s hold. The backend owns the real deadline: it may report
   * the remaining time and freezes it while you speak (§3.3.5); without a report the
   * client counts 4 s from the moment `committing` arrived.
   */
  private holdDeadline(
    draft: { state: string; holdRemainingMs?: number; holdFrozen?: boolean },
    prevState: string | null
  ): number | null {
    if (draft.state !== 'committing' || draft.holdFrozen) return null;
    if (typeof draft.holdRemainingMs === 'number') return this.fx.timers.now() + draft.holdRemainingMs;
    // Unfrozen without a report: at least 1 s is left (§3.3.5).
    if (prevState === 'committing') return this.store.getSnapshot().holdUntil ?? this.fx.timers.now() + 1000;
    return this.fx.timers.now() + HOLD_MS;
  }

  private onReadback(draftId: string, version: number, readbackId: string, url: string): void {
    const draft = this.store.getSnapshot().draft;
    if (!draft || draft.draftId !== draftId || draft.version !== version) return;
    void this.playClip('readback', url || readbackId, readbackId, () => {
      const d = this.store.getSnapshot().draft;
      return Boolean(d && d.draftId === draftId && d.version === version);
    });
  }

  /**
   * Fetch + play a clip; on a full (not truncated) play report `voice.playbackFinished`.
   * A read-back may cut a follow-up clip, never the other way round.
   */
  private async playClip(
    kind: 'readback' | 'followUp',
    urlOrId: string,
    clipId: string,
    stillWanted: () => boolean = () => true,
    draftLine = false
  ): Promise<void> {
    const clips = this.clips;
    const ctx = this.ctx;
    if (!clips || !ctx) return;
    if (kind === 'readback') this.readbackPending++;
    let started = false;
    let requeued = false;
    try {
      const data = await this.fx.api.fetchClip(urlOrId);
      if (this.clips !== clips || !stillWanted()) return;
      if (kind === 'followUp' && this.followUpBlocked(draftLine)) {
        // Clips are single use: keep the fetched audio's slot and retry later (no tone again).
        this.followUpQueue.unshift({ clipId, urlOrId, tone: null, draftLine });
        requeued = true;
        return;
      }
      this.playingKind = kind;
      if (kind === 'readback') this.store.update({ readbackPlaying: true });
      const outcome = await clips.play(data, {
        // The wake word ignores our own voice exactly while the clip is heard.
        onStart: (_tStart, tEnd) => {
          started = true;
          this.fx.wakeWord.suppress(tEnd + 0.3, true);
        },
      });
      if (!outcome.completed && started) this.fx.wakeWord.suppress(ctx.currentTime + 0.3, true);
      if (this.clips !== clips) return;
      if (outcome.completed) {
        this.socket?.send({ name: 'voice.playbackFinished', readbackId: clipId, tEnd: outcome.tEnd });
        if (kind === 'readback') this.earcon('yourTurn');
      }
    } catch {
      if (kind === 'readback') this.store.update({ notice: { code: 'clipFailed' } });
    } finally {
      if (kind === 'readback') {
        this.readbackPending = Math.max(0, this.readbackPending - 1);
        this.store.update({ readbackPlaying: false });
      }
      if (this.playingKind === kind) this.playingKind = null;
      if (kind === 'followUp') this.followUpBusy = false;
      if (kind === 'followUp' && !requeued && clipId === this.askClipId) {
        this.askClipId = null;
        this.startAskCall();
      }
      this.flushFollowUps();
    }
  }

  /**
   * Follow-up audio waits while a read-back plays. Agent lines also wait while a draft awaits
   * your answer; Jarvis's own lines about the draft ("say it again, or tap the card") do not.
   */
  private followUpBlocked(draftLine = false): boolean {
    if (this.readbackPending > 0 || this.playingKind === 'readback') return true;
    if (draftLine) return false;
    const draft = this.store.getSnapshot().draft;
    return Boolean(draft && (CONFIRMABLE_DRAFT_STATES.has(draft.state) || draft.state === 'ambiguous'));
  }

  private canPlayFollowUp(draftLine = false): boolean {
    return !this.followUpBusy && !this.followUpBlocked(draftLine);
  }

  private flushFollowUps(): void {
    if (!this.followUpQueue.length || this.followUpBusy || !this.ctx) return;
    // The first clip that may play now (draft lines can pass agent lines held by a draft).
    const index = this.followUpQueue.findIndex((c) => !this.followUpBlocked(c.draftLine));
    if (index < 0) return;
    this.followUpBusy = true;
    const [next] = this.followUpQueue.splice(index, 1);
    const endsAt = next.tone ? this.earcon(next.tone) : null;
    const delayMs = endsAt !== null && this.ctx ? Math.max(0, (endsAt - this.ctx.currentTime) * 1000) : 0;
    this.fx.timers.setTimeout(
      () => void this.playClip('followUp', next.urlOrId, next.clipId, undefined, next.draftLine),
      delayMs
    );
  }

  /** Queue a clip once: `voice.followUp` and the `voice.wake` after it name the same single-use clip. */
  private enqueueClip(clip: QueuedClip): boolean {
    if (this.seenClips.includes(clip.clipId)) return false;
    this.seenClips = [...this.seenClips, clip.clipId].slice(-MAX_SEEN_CLIPS);
    if (this.followUpQueue.length >= MAX_FOLLOW_UPS) this.followUpQueue.shift();
    this.followUpQueue.push(clip);
    this.flushFollowUps();
    return true;
  }

  private onFollowUp(frame: ServerFrame & { name: 'voice.followUp' }): void {
    const draftLine = DRAFT_LINE_STATUSES.has(frame.status);
    if (frame.status === 'confirm_rejected') {
      // About the card on screen, not a conversation event: shown on the card, not in the list.
      this.store.update({ draftHint: frame.line });
    } else {
      const entry = {
        id: ++this.followUpSeq,
        conversationId: frame.conversationId,
        status: frame.status,
        line: frame.line,
        clipId: frame.clipId,
        at: this.fx.timers.now(),
      };
      this.store.update((view) => ({ followUps: [entry, ...view.followUps].slice(0, MAX_FOLLOW_UPS) }));
    }
    // Draft outcomes already sound through the card's earcons; agent lines get the agent tone.
    const tone: EarconName | null = NEEDS_YOU_STATUSES.has(frame.status) ? 'needsYou' : draftLine ? null : 'agent';
    if (frame.status === 'needs_approval') this.fx.vibrate([60, 60, 60]);
    // An agent question without a live call opens a short answer call once it was heard.
    const askWithoutCall = frame.status === 'asks' && !this.machine.call && this.machine.mode === 'armed';
    if (askWithoutCall) this.store.update({ overlayOpen: true });
    if (!frame.clipId) {
      // Text-only line: the tone still marks it (unless it would talk over a read-back).
      if (tone && this.canPlayFollowUp(draftLine)) this.earcon(tone);
      if (askWithoutCall) this.startAskCall();
      return;
    }
    if (askWithoutCall) this.askClipId = frame.clipId;
    this.enqueueClip({ clipId: frame.clipId, urlOrId: frame.clipId, tone, draftLine });
  }

  /**
   * `voice.wake`: a follow-up, `say` or `ask` arrived while no call is live. Play its clip
   * without opening a provider call (only an `ask` opens one, after the question was heard).
   */
  private onWake(reason: string, itemId: string | null): void {
    if (this.ctx) void this.ctx.resume().catch((): undefined => undefined);
    this.store.update({ overlayOpen: true });
    if (!itemId) return;
    const queued = this.enqueueClip({
      clipId: itemId,
      urlOrId: itemId,
      tone: reason === 'follow_up' ? null : 'agent',
      draftLine: false,
    });
    if (queued && reason === 'asks' && !this.machine.call) this.askClipId = itemId;
  }

  /** Open the answer-only call for an agent `ask` (closes after the answer or 2 min). */
  private startAskCall(): void {
    if (this.machine.mode !== 'armed' || this.machine.call || this.machine.socket !== 'open') return;
    this.wake(this.ctx?.currentTime ?? 0);
    if (!this.machine.call) return;
    this.store.update({ asking: true });
    this.askTimer = this.fx.timers.setTimeout(() => {
      this.askTimer = null;
      if (this.store.getSnapshot().asking) this.hangUp();
    }, ASK_CALL_MAX_MS);
  }

  private onVad(speech: boolean, t: number): void {
    if (!speech || !this.machine.call?.voiceSessionId) return;
    this.socket?.send({ name: 'voice.speechOnset', t });
  }

  // -------------------------------------------------------------------------
  // Page lifecycle
  // -------------------------------------------------------------------------

  private onVisible(): void {
    if (this.machine.mode === 'off') return;
    this.fx.wakeLock.reacquireIfWanted();
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch((): undefined => undefined);
  }

  private onFreeze(): void {
    if (this.machine.mode !== 'armed') return;
    this.socket?.send({ name: 'voice.frozen' });
    // A frozen device is "not armed": the backend hangs the call up.
    this.endCall('frozen', false);
    this.dispatch({ type: 'frozen' });
  }

  private onResume(): void {
    if (this.machine.mode !== 'frozen') return;
    this.dispatch({ type: 'resumed' });
    this.socket?.send({ name: 'voice.resumed' });
    this.onVisible();
    this.earcon('back');
  }

  private onContextState(): void {
    const state = this.ctx?.state as string | undefined;
    const paused = state === 'interrupted' || (state === 'suspended' && this.machine.mode !== 'off');
    this.store.update({ systemPaused: paused });
    if (state === 'suspended' && this.fx.isVisible()) void this.ctx?.resume().catch((): undefined => undefined);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private dispatch(event: VoiceEvent): void {
    const prev = this.machine;
    const next = reduceVoice(prev, event);
    if (next === prev) return;
    this.machine = next;
    if (decideNextMute(prev, next)) this.capture?.mute();
    else if (!isOutgoingLive(prev) && isOutgoingLive(next)) this.capture?.setLive(this.pendingPreroll ?? undefined);
    this.store.update({ machine: next });
  }

  private earcon(name: EarconName): number | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const endsAt = this.fx.playEarcon(ctx, name);
    if (endsAt !== null) this.fx.wakeWord.suppress(endsAt + 0.3);
    return endsAt;
  }

  private clearTimer(
    key: 'deadManTimer' | 'readyTimer' | 'draftTimer' | 'resumeTimer' | 'askTimer' | 'askHangupTimer'
  ): void {
    const handle = this[key];
    if (handle) this.fx.timers.clearTimeout(handle);
    this[key] = null;
  }
}
