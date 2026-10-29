// Služba pro centralizovaný monitoring, logging a analytiku.
// GA4 je nyní striktně oddělen: měřicí kód hlavního webu (centrumunity.cz) byl odebrán.
// Pokud bude studio chtít sledovat aplikaci, stačí nastavit dedikované VITE_GA4_MEASUREMENT_ID.

type EventName = 
  | 'view_item' 
  | 'begin_checkout' 
  | 'purchase' 
  | 'search' 
  | 'login' 
  | 'sign_up' 
  | 'booking_error';

interface AnalyticsEvent {
  name: EventName;
  params?: Record<string, any>;
}

// Dedikované měřicí ID pro aplikaci rezervačního systému (pokud je nakonfigurováno).
// Nikdy sem nevkládejte ID hlavního webu (GT-TWR86R5H / G-...), aby se nemíchala data terapeutů s klienty webu.
const GA4_MEASUREMENT_ID = (import.meta as any).env?.VITE_GA4_MEASUREMENT_ID?.trim() || '';

let isGaInitialized = false;

function ensureGaInitialized() {
  if (typeof window === 'undefined' || !GA4_MEASUREMENT_ID || isGaInitialized) return;
  try {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_MEASUREMENT_ID)}`;
    document.head.appendChild(script);

    const win = window as any;
    win.dataLayer = win.dataLayer || [];
    function gtag(...args: any[]) {
      win.dataLayer.push(args);
    }
    win.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA4_MEASUREMENT_ID, {
      cookie_flags: 'SameSite=None;Secure'
    });
    isGaInitialized = true;
  } catch (err) {
    console.error('Failed to initialize dedicated GA4', err);
  }
}

export const Monitoring = {
  // 1. Error Logging (např. Sentry)
  logError: (error: Error, context?: Record<string, any>) => {
    if (process.env.NODE_ENV === 'development') {
      console.groupCollapsed('🔴 [Error Logged]');
      console.error(error);
      if (context) console.table(context);
      console.groupEnd();
    } else {
      // TODO: Sentry.captureException(error, { extra: context });
      console.error("[Sentry Placeholder]", error.message);
    }
  },

  // 2. User Analytics (oddělený dedikovaný GA4, pokud je zadán)
  trackEvent: (event: AnalyticsEvent) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`📊 [Analytics]: ${event.name}`, event.params);
    }
    if (GA4_MEASUREMENT_ID) {
      ensureGaInitialized();
      if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
        (window as any).gtag('event', event.name, event.params);
      }
    }
  },

  // 3. Page View Tracking (oddělený dedikovaný GA4, pokud je zadán)
  trackPageView: (path: string) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`👀 [PageView]: ${path}`);
    }
    if (GA4_MEASUREMENT_ID) {
      ensureGaInitialized();
      if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
        (window as any).gtag('event', 'page_view', { page_path: path });
      }
    }
  },

  // 4. Web Vitals (Performance)
  reportWebVitals: (_metric: any) => {
    // console.log(_metric);
  }
};