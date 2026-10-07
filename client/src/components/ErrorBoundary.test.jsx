import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import ErrorBoundary from './ErrorBoundary';

function Boom({ message = 'kaboom' }) {
  throw new Error(message);
}

function BoomInEffect() {
  useEffect(() => {
    throw new Error('effect failed');
  }, []);
  return <p>rendered</p>;
}

let consoleError;

beforeEach(() => {
  // React logs caught errors; keep the output clean but still assert on it
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>תוכן תקין</p>
      </ErrorBoundary>
    );

    expect(screen.getByText('תוכן תקין')).toBeInTheDocument();
    expect(screen.queryByText('אירעה שגיאה בטעינת המסך')).not.toBeInTheDocument();
  });

  it('shows the Hebrew fallback instead of a blank page when a child throws while rendering', () => {
    render(
      <ErrorBoundary>
        <p>אח</p>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('אירעה שגיאה בטעינת המסך')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'רענן את הדף' })).toBeInTheDocument();
    expect(screen.queryByText('אח')).not.toBeInTheDocument();
  });

  it('catches errors thrown from effects', () => {
    render(
      <ErrorBoundary>
        <BoomInEffect />
      </ErrorBoundary>
    );

    expect(screen.getByText('אירעה שגיאה בטעינת המסך')).toBeInTheDocument();
  });

  it('logs the error through componentDidCatch', () => {
    render(
      <ErrorBoundary>
        <Boom message="specific failure" />
      </ErrorBoundary>
    );

    expect(consoleError).toHaveBeenCalledWith(
      'Unhandled UI error:',
      expect.objectContaining({ message: 'specific failure' }),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });

  it('reloads the page when the refresh button is clicked', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { href: 'http://localhost:3000/', pathname: '/', reload });

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    await userEvent.click(screen.getByRole('button', { name: 'רענן את הדף' }));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
