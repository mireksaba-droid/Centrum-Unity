import React, { useEffect } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { Practitioner, Role } from './types.ts';
import Login from './pages/Login.tsx';
import StudioSchedule from './pages/StudioSchedule.tsx';
import AdminDashboard from './pages/AdminDashboard.tsx';
import PractitionerDashboard from './pages/PractitionerDashboard.tsx';
import PublicEventPage from './pages/PublicEventPage.tsx';
import PaymentPage from './pages/PaymentPage.tsx';
import TermsPage from './pages/TermsPage.tsx';
import PrivacyPage from './pages/PrivacyPage.tsx';
import { Footer } from './components/Footer.tsx';
import { Monitoring } from './services/monitoring.ts';
import { ToastProvider } from './contexts/ToastContext.tsx';
import { useStore } from './store/useStore.ts';

// --- Analytics & UX Helpers ---
const PageTracker = () => {
  const location = useLocation();
  useEffect(() => {
    Monitoring.trackPageView(location.pathname);
    window.scrollTo(0, 0); 
  }, [location]);
  return null;
};

const AppContent = () => {
  const {
    currentUser,
    setCurrentUser,
    bookings,
    practitionersList,
    groupEvents,
    eventRegistrations,
    addBooking,
    cancelBooking,
    adminRescheduleBooking,
    updatePractitioner,
    addPractitioner,
    createGroupEvent,
    updateGroupEvent,
    deleteGroupEvent,
    registerForEvent,
    initializeBookings
  } = useStore();

  const navigate = useNavigate();

  useEffect(() => {
    initializeBookings();

    // Hash-to-Path redirect for production BrowserRouter:
    // If a link with /#/event/... or /#/pay/... was clicked, but we are running in BrowserRouter,
    // we want to dynamically redirect to the path-based equivalent (/event/... or /pay/...)
    const hash = window.location.hash;
    if (hash && hash.startsWith('#/')) {
      const cleanPath = hash.substring(1); // removes the '#' (results in e.g. /event/id)
      navigate(cleanPath, { replace: true });
    }
  }, [initializeBookings, navigate]);

  const handleLogin = (user: Practitioner, token?: string) => { 
      setCurrentUser(user, token); 
      if (user.role === Role.ADMIN) {
          navigate('/admin');
      } else {
          navigate('/schedule');
      }
  };
  
  const handleLogout = () => { 
      setCurrentUser(null); 
      navigate('/login'); 
  };

  return (
      <div className="min-h-screen bg-[#f1e9dc] font-sans text-stone-800 flex flex-col">
          <Routes>
            <Route path="/login" element={<Login onLogin={handleLogin} />} />
            
            <Route path="/schedule" element={
                currentUser ? (
                    currentUser.role === Role.ADMIN ? <Navigate to="/admin" /> : (
                        <StudioSchedule 
                            currentUser={currentUser}
                            allBookings={bookings}
                            groupEvents={groupEvents}
                            onBook={addBooking}
                            onCancel={cancelBooking}
                            onLogout={handleLogout}
                        />
                    )
                ) : <Navigate to="/login" />
            } />

            <Route path="/admin" element={
                currentUser && currentUser.role === Role.ADMIN ? (
                    <AdminDashboard 
                        allBookings={bookings}
                        practitioners={practitionersList}
                        groupEvents={groupEvents}
                        eventRegistrations={eventRegistrations}
                        updatePractitioner={updatePractitioner}
                        onAddPractitioner={addPractitioner}
                        onAdminReschedule={adminRescheduleBooking}
                        onCreateGroupEvent={createGroupEvent}
                        onUpdateGroupEvent={updateGroupEvent}
                        onDeleteGroupEvent={deleteGroupEvent}
                        onBook={addBooking}
                        onCancel={cancelBooking}
                        onLogout={handleLogout}
                    />
                ) : <Navigate to="/login" />
            } />

            <Route path="/dashboard" element={
                currentUser ? (
                    <PractitionerDashboard 
                        practitioners={practitionersList}
                        updatePractitioner={updatePractitioner}
                        allBookings={bookings}
                        currentUser={currentUser}
                        onCancelBooking={cancelBooking}
                        onInternalBook={addBooking}
                    />
                ) : <Navigate to="/login" />
            } />

            <Route path="/event/:eventId" element={
                <PublicEventPage 
                    events={groupEvents} 
                    registrations={eventRegistrations} 
                    onRegister={registerForEvent} 
                />
            } />

            <Route path="/pay/:bookingId" element={<PaymentPage />} />

            <Route path="/obchodni-podminky" element={<TermsPage />} />
            <Route path="/ochrana-udaju" element={<PrivacyPage />} />

            <Route path="*" element={<Navigate to={currentUser ? (currentUser.role === Role.ADMIN ? "/admin" : "/schedule") : "/login"} />} />
          </Routes>
          <Footer />
      </div>
  );
};

const App = () => { 
    const isPreview = window.location.hostname.includes('usercontent.goog') || 
                      window.location.hostname.includes('webcontainer.io') ||
                      window.location.hostname.includes('idx.google.com');

    const Router = isPreview ? HashRouter : BrowserRouter;

    return (
        <Router>
            <ToastProvider> 
                <PageTracker />
                <AppContent />
            </ToastProvider>
        </Router>
    ); 
};
export default App;