import { describe, expect, it, vi } from 'vitest';
import {
  MIC_LEVELS,
  nextMicLevel,
  openCapture,
  openMicStream,
  openMicStreamAt,
} from '@/renderer/voice/capture/micCapture';
import { AudioWorkletUnavailableError } from '@/renderer/services/speech/pcmRecorder';

const stream = {} as MediaStream;

describe('openMicStream', () => {
  it('asks for echoCancellation "all" (cancels page playback too) with NS + AGC, mono', async () => {
    const gum = vi.fn(async () => stream);
    await openMicStream(gum);
    expect(gum).toHaveBeenCalledWith({
      audio: {
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        echoCancellation: { ideal: 'all' },
      },
      video: false,
    });
  });

  it('falls back to echoCancellation: true when "all" is not understood', async () => {
    const gum = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('bad'), { name: 'TypeError' }))
      .mockResolvedValueOnce(stream);
    await expect(openMicStream(gum)).resolves.toBe(stream);
    expect(gum.mock.calls[1][0].audio.echoCancellation).toBe(true);
  });

  it('does not retry a permission refusal', async () => {
    const gum = vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await expect(openMicStream(gum)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(gum).toHaveBeenCalledTimes(1);
  });
});

describe('mic levels (TASK-106)', () => {
  it('fall back all → standard → plain → none', () => {
    expect(MIC_LEVELS).toEqual(['all', 'standard', 'plain']);
    expect(nextMicLevel('all')).toBe('standard');
    expect(nextMicLevel('standard')).toBe('plain');
    expect(nextMicLevel('plain')).toBeNull();
  });

  it('standard asks for echoCancellation: true with NS + AGC', async () => {
    const gum = vi.fn(async () => stream);
    await expect(openMicStreamAt(gum, 'standard')).resolves.toEqual({ stream, level: 'standard' });
    expect(gum).toHaveBeenCalledWith({
      audio: { noiseSuppression: true, autoGainControl: true, channelCount: 1, echoCancellation: true },
      video: false,
    });
  });

  it('plain asks for audio: true only', async () => {
    const gum = vi.fn(async () => stream);
    await openMicStream(gum, 'plain');
    expect(gum).toHaveBeenCalledWith({ audio: true, video: false });
  });

  it('reports standard when "all" fell back', async () => {
    const gum = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('bad'), { name: 'OverconstrainedError' }))
      .mockResolvedValueOnce(stream);
    await expect(openMicStreamAt(gum, 'all')).resolves.toEqual({ stream, level: 'standard' });
  });
});

describe('openCapture', () => {
  it('requires AudioWorklet support', async () => {
    await expect(openCapture({} as AudioContext)).rejects.toBeInstanceOf(AudioWorkletUnavailableError);
  });
});
