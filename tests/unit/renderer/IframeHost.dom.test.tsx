/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const policyMocks = vi.hoisted(() => ({ landOnApp: false }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/components/media/iframeHostPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/components/media/iframeHostPolicy')>();
  return { ...actual, isAppOriginFrame: () => policyMocks.landOnApp };
});

import IframeHost from '@/renderer/components/media/IframeHost';
import WebviewHost from '@/renderer/components/media/WebviewHost';

const frame = () => screen.getByTestId('iframe-host-frame') as HTMLIFrameElement;
const address = () => screen.getByTestId('iframe-host-address') as HTMLInputElement;
const submitAddress = (value: string) => {
  fireEvent.change(address(), { target: { value } });
  fireEvent.keyDown(address(), { key: 'Enter', code: 'Enter', keyCode: 13 });
};

beforeEach(() => {
  policyMocks.landOnApp = false;
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IframeHost (web browser panel)', () => {
  it('renders a sandboxed iframe for an external page, with no delegated devices', () => {
    render(<IframeHost url='https://example.com/' showNavBar />);
    expect(frame().getAttribute('src')).toBe('https://example.com/');
    expect(frame().getAttribute('sandbox')).not.toContain('allow-popups-to-escape-sandbox');
    expect(frame().getAttribute('allow')).toBe('fullscreen');
    expect(frame().getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(screen.getByText('preview.browser.webModeHint')).toBeTruthy();
    expect(address().getAttribute('aria-label')).toBe('preview.browser.addressLabel');
  });

  it("refuses the app's own origin", () => {
    render(<IframeHost url={`${window.location.origin}/conversation/1`} showNavBar />);
    expect(screen.queryByTestId('iframe-host-frame')).toBeNull();
    expect(screen.getByText('preview.browser.cannotEmbedSelf')).toBeTruthy();
  });

  it('refuses non-web schemes', () => {
    render(<IframeHost url='javascript:alert(1)' showNavBar />);
    expect(screen.queryByTestId('iframe-host-frame')).toBeNull();
    expect(screen.getByText('preview.browser.unsupportedUrl')).toBeTruthy();
  });

  it('removes the frame when the embedded page lands on the app origin', () => {
    render(<IframeHost url='https://example.com/' showNavBar />);
    policyMocks.landOnApp = true;
    fireEvent.load(frame());
    expect(screen.queryByTestId('iframe-host-frame')).toBeNull();
    expect(screen.getByText('preview.browser.cannotEmbedSelf')).toBeTruthy();
  });

  it('marks the address as stale after the page navigated by itself', () => {
    render(<IframeHost url='https://example.com/' showNavBar />);
    fireEvent.load(frame());
    expect(address().getAttribute('title')).toBeNull();
    fireEvent.load(frame());
    expect(address().getAttribute('title')).toBe('preview.browser.mayHaveNavigated');
    expect(screen.getByTestId('iframe-host-stale').textContent).toBe('preview.browser.navigatedChip');
  });

  it('opens the current page in a new tab without opener', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<IframeHost url='https://example.com/page' showNavBar />);
    fireEvent.click(screen.getByTestId('iframe-host-open-new-tab'));
    expect(open).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer');
  });

  it('navigates from the address bar, supports back/forward and resets the favicon', () => {
    const onUrlChange = vi.fn();
    const onTitleChange = vi.fn();
    const onFaviconChange = vi.fn();
    render(
      <IframeHost
        url='https://example.com/'
        showNavBar
        onUrlChange={onUrlChange}
        onTitleChange={onTitleChange}
        onFaviconChange={onFaviconChange}
      />
    );
    submitAddress('example.org/x');
    expect(frame().getAttribute('src')).toBe('https://example.org/x');
    expect(onUrlChange).toHaveBeenLastCalledWith('https://example.org/x');
    expect(onTitleChange).toHaveBeenLastCalledWith('example.org');
    expect(onFaviconChange).toHaveBeenLastCalledWith('');

    fireEvent.click(screen.getByLabelText('common.historyBack'));
    expect(frame().getAttribute('src')).toBe('https://example.com/');
    fireEvent.click(screen.getByLabelText('common.forward'));
    expect(frame().getAttribute('src')).toBe('https://example.org/x');
  });

  it('re-submitting the current address reloads instead of adding history (no stuck spinner)', () => {
    render(<IframeHost url='https://example.com/' showNavBar />);
    const before = frame();
    submitAddress('https://example.com/');
    expect(frame()).not.toBe(before);
    expect((screen.getByLabelText('common.historyBack') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('iframe-host-loading')).toBeTruthy();
    fireEvent.load(frame());
    expect(screen.queryByTestId('iframe-host-loading')).toBeNull();
  });

  it('labels a tab opened with an address on its first load', () => {
    const onTitleChange = vi.fn();
    render(<IframeHost url='https://example.com/x' showNavBar onTitleChange={onTitleChange} />);
    expect(onTitleChange).not.toHaveBeenCalled();
    fireEvent.load(frame());
    expect(onTitleChange).toHaveBeenLastCalledWith('example.com');
  });

  it('reports a blank page as loaded after going back to it', () => {
    const onDidFinishLoad = vi.fn();
    render(<IframeHost url='about:blank' showNavBar onDidFinishLoad={onDidFinishLoad} />);
    onDidFinishLoad.mockClear();
    submitAddress('example.org');
    fireEvent.click(screen.getByLabelText('common.historyBack'));
    expect(screen.queryByTestId('iframe-host-frame')).toBeNull();
    expect(onDidFinishLoad).toHaveBeenCalled();
  });

  it('offers the devices toggle only for dev servers and delegates mic/camera after opt-in', () => {
    const { rerender } = render(<IframeHost url='https://example.com/' showNavBar />);
    expect(screen.queryByTestId('iframe-host-devices')).toBeNull();
    rerender(<IframeHost url={`https://app-3000.${window.location.hostname}/`} showNavBar />);
    const toggle = screen.getByTestId('iframe-host-devices');
    expect(frame().getAttribute('allow')).toBe('fullscreen');
    fireEvent.click(toggle);
    expect(frame().getAttribute('allow')).toBe('fullscreen; microphone; camera');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('restores the address on Escape', () => {
    render(<IframeHost url='https://example.com/' showNavBar />);
    fireEvent.change(address(), { target: { value: 'something else' } });
    fireEvent.keyDown(address(), { key: 'Escape' });
    expect(address().value).toBe('https://example.com/');
  });

  it('follows url prop changes with a fresh history, including clearing to blank', () => {
    const onDidFinishLoad = vi.fn();
    const { rerender } = render(<IframeHost url='https://example.com/' showNavBar onDidFinishLoad={onDidFinishLoad} />);
    rerender(<IframeHost url='https://example.net/' showNavBar onDidFinishLoad={onDidFinishLoad} />);
    expect(frame().getAttribute('src')).toBe('https://example.net/');
    expect((screen.getByLabelText('common.historyBack') as HTMLButtonElement).disabled).toBe(true);
    rerender(<IframeHost url='' showNavBar onDidFinishLoad={onDidFinishLoad} />);
    expect(screen.queryByTestId('iframe-host-frame')).toBeNull();
    expect(onDidFinishLoad).toHaveBeenCalled();
  });

  it('lets the user dismiss the hint for the session', () => {
    render(<IframeHost url='https://example.com/' showNavBar />);
    fireEvent.click(screen.getByTestId('iframe-host-dismiss-hint'));
    expect(screen.queryByText('preview.browser.webModeHint')).toBeNull();
    expect(window.sessionStorage.getItem('aionui.iframeHost.hintDismissed')).toBe('1');
  });

  it('reports load completion', () => {
    const onDidFinishLoad = vi.fn();
    render(<IframeHost url='https://example.com/' onDidFinishLoad={onDidFinishLoad} />);
    fireEvent.load(frame());
    expect(onDidFinishLoad).toHaveBeenCalledTimes(1);
  });
});

describe('WebviewHost platform dispatch', () => {
  it('uses the iframe host when not running in Electron', () => {
    const w = window as unknown as { electronAPI?: unknown };
    const saved = w.electronAPI;
    delete w.electronAPI;
    try {
      render(<WebviewHost url='https://example.com/' showNavBar />);
      expect(screen.getByTestId('iframe-host')).toBeTruthy();
    } finally {
      w.electronAPI = saved;
    }
  });
});
