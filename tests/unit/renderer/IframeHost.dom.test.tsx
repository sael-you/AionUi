/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IframeHost from '@/renderer/components/media/IframeHost';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IframeHost (web browser panel)', () => {
  it('renders a sandboxed iframe for an external page', () => {
    render(<IframeHost url='https://example.com/' showNavBar />);
    const frame = screen.getByTestId('iframe-host-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('https://example.com/');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(frame.getAttribute('allow')).not.toContain('microphone');
    expect(screen.getByText('preview.browser.webModeHint')).toBeTruthy();
  });

  it("refuses to embed the app's own origin", () => {
    render(<IframeHost url={`${window.location.origin}/conversation/1`} showNavBar />);
    expect(screen.queryByTestId('iframe-host-frame')).toBeNull();
    expect(screen.getByText('preview.browser.cannotEmbedSelf')).toBeTruthy();
  });

  it('refuses non-web schemes', () => {
    render(<IframeHost url='javascript:alert(1)' showNavBar />);
    expect(screen.queryByTestId('iframe-host-frame')).toBeNull();
    expect(screen.getByText('preview.browser.unsupportedUrl')).toBeTruthy();
  });

  it('opens the current page in a new tab without opener', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<IframeHost url='https://example.com/page' showNavBar />);
    fireEvent.click(screen.getByTestId('iframe-host-open-new-tab'));
    expect(open).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer');
  });

  it('navigates from the address bar and supports back/forward', () => {
    const onUrlChange = vi.fn();
    const onTitleChange = vi.fn();
    render(
      <IframeHost url='https://example.com/' showNavBar onUrlChange={onUrlChange} onTitleChange={onTitleChange} />
    );
    const input = screen.getByPlaceholderText('preview.browser.addressPlaceholder') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'example.org/x' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect((screen.getByTestId('iframe-host-frame') as HTMLIFrameElement).getAttribute('src')).toBe(
      'https://example.org/x'
    );
    expect(onUrlChange).toHaveBeenLastCalledWith('https://example.org/x');
    expect(onTitleChange).toHaveBeenLastCalledWith('example.org');

    fireEvent.click(screen.getByLabelText('common.historyBack'));
    expect((screen.getByTestId('iframe-host-frame') as HTMLIFrameElement).getAttribute('src')).toBe(
      'https://example.com/'
    );
    fireEvent.click(screen.getByLabelText('common.forward'));
    expect((screen.getByTestId('iframe-host-frame') as HTMLIFrameElement).getAttribute('src')).toBe(
      'https://example.org/x'
    );
  });

  it('reports load completion', () => {
    const onDidFinishLoad = vi.fn();
    render(<IframeHost url='https://example.com/' onDidFinishLoad={onDidFinishLoad} />);
    fireEvent.load(screen.getByTestId('iframe-host-frame'));
    expect(onDidFinishLoad).toHaveBeenCalledTimes(1);
  });
});
