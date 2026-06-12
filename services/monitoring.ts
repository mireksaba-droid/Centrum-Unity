// Služba pro centralizovaný monitoring, logging a analytiku.
// V produkci zde budou napojeny služby jako Sentry, Google Analytics 4, nebo PostHog.

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

  // 2. User Analytics (např. GA4 / GTM)
  trackEvent: (event: AnalyticsEvent) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`📊 [Analytics]: ${event.name}`, event.params);
    } else {
      // TODO: window.gtag('event', event.name, event.params);
    }
  },

  // 3. Page View Tracking
  trackPageView: (path: string) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`👀 [PageView]: ${path}`);
    } else {
      // TODO: GA4 page_view
    }
  },

  // 4. Web Vitals (Performance)
  reportWebVitals: (metric: any) => {
    // Může být odesláno do analytiky pro sledování rychlosti načítání (LCP, FID, CLS)
    // console.log(metric);
  }
};