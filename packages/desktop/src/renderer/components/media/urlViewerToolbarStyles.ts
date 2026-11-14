/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Toolbar styles shared by the desktop webview host and the web iframe host. */
export const URL_VIEWER_TOOLBAR_CSS = `
.aion-url-viewer-toolbar {
  --viewer-border: var(--color-border-2);
  --viewer-border-hover: var(--color-border-3);
  --viewer-bg: var(--color-bg-3);
  --viewer-bg-hover: var(--color-fill-2);
  --viewer-text: var(--color-text-2);
  --viewer-text-muted: var(--color-text-3);
}
.aion-url-viewer-toolbar .toolbar-btn {
  -webkit-appearance: none;
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  min-width: 30px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--viewer-border);
  background: var(--viewer-bg);
  color: var(--viewer-text);
  line-height: 1;
  font-size: 12px;
  transition: all 150ms ease;
  cursor: pointer;
}
.aion-url-viewer-toolbar .toolbar-btn.icon-btn {
  width: 30px;
  min-width: 30px;
  padding: 0;
}
.aion-url-viewer-toolbar .toolbar-btn:hover:not(:disabled) {
  background: var(--viewer-bg-hover);
  border-color: var(--viewer-border-hover);
}
.aion-url-viewer-toolbar .toolbar-btn:active:not(:disabled) {
  transform: translateY(0.5px);
}
.aion-url-viewer-toolbar .toolbar-btn:focus-visible {
  outline: none;
  border-color: rgb(var(--primary-6));
  box-shadow: 0 0 0 2px rgba(var(--primary-6), 0.12);
}
.aion-url-viewer-toolbar .toolbar-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  color: var(--viewer-text-muted);
  background: var(--color-bg-2);
}
.aion-url-viewer-toolbar .toolbar-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  min-width: 48px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--viewer-border);
  background: var(--color-bg-2);
  color: var(--viewer-text-muted);
  font-size: 11px;
  line-height: 1;
}
.aion-url-viewer-toolbar .toolbar-input {
  -webkit-appearance: none;
  appearance: none;
  /* box-sizing 必须显式声明：width:100% 配 padding + border 时，
     content-box 会把左右各 13px（12px padding + 1px border）加在
     100% 之外，整行被顶宽 26px 而溢出预览框右边缘。
     box-sizing must be explicit: with width:100% plus padding and
     border, content-box adds 13px per side (12px padding + 1px
     border) on top of the 100%, widening the row by 26px so it
     overflows the preview panel's right edge. */
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--viewer-border);
  background: var(--viewer-bg);
  color: var(--color-text-1);
  font-size: 12px;
  line-height: 30px;
  transition: all 150ms ease;
}
.aion-url-viewer-toolbar .toolbar-input:hover {
  border-color: var(--viewer-border-hover);
}
.aion-url-viewer-toolbar .toolbar-input:focus {
  outline: none;
  border-color: rgb(var(--primary-6));
  box-shadow: 0 0 0 2px rgba(var(--primary-6), 0.12);
}
`;
