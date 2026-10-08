import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

beforeEach(() => {
  localStorage.clear();
  // jsdom does not implement scrolling; the scroll-lock hook and modals call it
  window.scrollTo = vi.fn();
});

afterEach(() => {
  // Not using `globals: true`, so RTL's auto-cleanup is not registered
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.className = '';
  document.body.removeAttribute('style');
});
