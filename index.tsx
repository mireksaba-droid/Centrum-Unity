
/// <reference types="vite/client" />
import React, { Component, ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from "@sentry/react";
import App from './App.tsx';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || "https://examplePublicKey@o0.ingest.sentry.io/0", // Placeholder pro Sentry DSN
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  // Tracing
  tracesSampleRate: 1.0, //  Capture 100% of the transactions
  // Set 'tracePropagationTargets' to control for which URLs distributed tracing should be enabled
  tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/],
  // Session Replay
  replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
  replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
});

console.log("Application Starting...");

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Jednoduchá komponenta pro zachycení chyb (Error Boundary) - rozšířeno o Sentry
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState;
  // Explicitly declare props to avoid TS errors in some environments
  readonly props: Readonly<ErrorBoundaryProps> & Readonly<{ children?: ReactNode }>;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.props = props; // Ensure props are available
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Critical Application Error:", error, errorInfo);
    Sentry.captureException(error, { extra: errorInfo as any });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', fontFamily: 'sans-serif', textAlign: 'center', backgroundColor: '#fff0f0', height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <h1 style={{ color: '#d32f2f', marginBottom: '20px' }}>Něco se pokazilo</h1>
          <p>Aplikace nemohla být načtena. Zde je technický detail chyby:</p>
          <pre style={{ 
            textAlign: 'left', 
            background: '#333', 
            color: '#fff', 
            padding: '20px', 
            borderRadius: '8px', 
            overflow: 'auto',
            maxWidth: '800px',
            width: '100%',
            marginTop: '20px',
            marginBottom: '20px'
          }}>
            {this.state.error?.message}
            <br />
            {this.state.error?.stack}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            style={{ padding: '12px 24px', cursor: 'pointer', background: '#333', color: 'white', border: 'none', borderRadius: '4px', fontSize: '16px' }}
          >
            Zkusit načíst znovu
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// FAILSAFE: Pokud se React nenačte do 3 sekund, vypíšeme chybu ručně do DOMu.
// To pomůže v situaci, kdy module loader selže tiše.
const loadingTimeout = setTimeout(() => {
    const root = document.getElementById('root');
    if (root && root.innerHTML === "") { // Still empty/loading via CSS
        console.error("React mount timed out.");
        document.body.innerHTML = `
            <div style="padding: 40px; font-family: sans-serif; text-align: center; color: #78350f; background-color: #fef3c7; height: 100vh; display: flex; flex-direction: column; justify-content: center;">
                <h1 style="font-size: 24px; margin-bottom: 16px;">Aplikace se nespustila</h1>
                <p>Došlo k chybě při načítání modulů. Pravděpodobně problém s připojením nebo konfigurací prohlížeče.</p>
                <p style="font-size: 12px; margin-top: 20px; opacity: 0.8;">Timeout: React failed to render into #root within 3000ms.</p>
                <button onclick="window.location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #78350f; color: white; border: none; border-radius: 6px; cursor: pointer;">Zkusit znovu</button>
            </div>
        `;
    }
}, 3000);

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Could not find root element to mount to");
  }

  console.log("Mounting React Root...");
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
  
  // Clear timeout if render call succeeded
  clearTimeout(loadingTimeout);
  console.log("React Render Initiated.");
} catch (e) {
  clearTimeout(loadingTimeout);
  console.error("Fatal Startup Error:", e);
  document.body.innerHTML = `<div style="color:red; padding: 20px; font-family: sans-serif;"><h1>Fatal Startup Error</h1><pre>${e instanceof Error ? e.message : String(e)}</pre></div>`;
}
