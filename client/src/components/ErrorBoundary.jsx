import { Component } from 'react';

// Top level safety net - a render/effect throw would otherwise leave a blank page
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="loading" style={{ height: '100vh', flexDirection: 'column', gap: '1rem' }}>
          <p>אירעה שגיאה בטעינת המסך</p>
          <button onClick={() => window.location.reload()} className="btn btn-primary">
            רענן את הדף
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
