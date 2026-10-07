import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useBodyScrollLockDefault, { useBodyScrollLock } from './useBodyScrollLock';

const body = document.body;
const isLocked = () => body.classList.contains('modal-open');

beforeEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  Object.defineProperty(window, 'scrollX', { value: 0, configurable: true, writable: true });
});

describe('useBodyScrollLock', () => {
  it('is also the default export', () => {
    expect(useBodyScrollLockDefault).toBe(useBodyScrollLock);
  });

  it('does nothing when not locked', () => {
    const { unmount } = renderHook(() => useBodyScrollLock(false));

    expect(isLocked()).toBe(false);
    expect(body.style.position).toBe('');
    unmount();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('locks the body and keeps the visual scroll position', () => {
    window.scrollY = 420;
    window.scrollX = 15;

    const { unmount } = renderHook(() => useBodyScrollLock(true));

    expect(isLocked()).toBe(true);
    expect(body.style.position).toBe('fixed');
    expect(body.style.top).toBe('-420px');
    expect(body.style.width).toBe('100%');
    expect(body.style.left).toBe('0px');
    unmount();
  });

  it('restores the body styles and scroll position on unmount', () => {
    window.scrollY = 300;
    window.scrollX = 7;
    const { unmount } = renderHook(() => useBodyScrollLock(true));

    unmount();

    expect(isLocked()).toBe(false);
    expect(body.style.position).toBe('');
    expect(body.style.top).toBe('');
    expect(body.style.width).toBe('');
    expect(body.style.left).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith(7, 300);
  });

  it('unlocks when the flag flips to false and locks again when it flips back', () => {
    window.scrollY = 50;
    const { rerender, unmount } = renderHook(({ locked }) => useBodyScrollLock(locked), {
      initialProps: { locked: true }
    });
    expect(isLocked()).toBe(true);

    rerender({ locked: false });
    expect(isLocked()).toBe(false);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 50);

    rerender({ locked: true });
    expect(isLocked()).toBe(true);

    unmount();
    expect(isLocked()).toBe(false);
  });

  it('does not re-run on re-renders with the same flag', () => {
    const { rerender, unmount } = renderHook(({ locked }) => useBodyScrollLock(locked), {
      initialProps: { locked: true }
    });
    rerender({ locked: true });
    rerender({ locked: true });

    expect(window.scrollTo).not.toHaveBeenCalled();
    unmount();
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('keeps the body locked until the last nested lock is released', () => {
    window.scrollY = 200;
    const outer = renderHook(() => useBodyScrollLock(true));

    // The inner modal mounts after the body is already fixed (window.scrollY reads 0 then)
    window.scrollY = 0;
    const inner = renderHook(() => useBodyScrollLock(true));
    expect(body.style.top).toBe('-200px');

    inner.unmount();
    expect(isLocked()).toBe(true);
    expect(body.style.position).toBe('fixed');
    expect(window.scrollTo).not.toHaveBeenCalled();

    outer.unmount();
    expect(isLocked()).toBe(false);
    // Restores the position saved by the first lock, not the inner one's 0
    expect(window.scrollTo).toHaveBeenCalledWith(0, 200);
  });

  it('handles the outer lock being released before the inner one', () => {
    window.scrollY = 120;
    const outer = renderHook(() => useBodyScrollLock(true));
    const inner = renderHook(() => useBodyScrollLock(true));

    outer.unmount();
    expect(isLocked()).toBe(true);

    inner.unmount();
    expect(isLocked()).toBe(false);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 120);
  });

  it('ignores unlocked instances when counting nested locks', () => {
    const locked = renderHook(() => useBodyScrollLock(true));
    const unlocked = renderHook(() => useBodyScrollLock(false));

    unlocked.unmount();
    expect(isLocked()).toBe(true);

    locked.unmount();
    expect(isLocked()).toBe(false);
  });
});
