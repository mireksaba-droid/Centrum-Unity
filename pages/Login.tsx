import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Practitioner, Role } from '../types';
import Button from '../components/Button';
import { Lock, ArrowRight, X, User, Leaf } from 'lucide-react';
import { useStore } from '../store/useStore';

interface LoginProps {
  onLogin: (user: Practitioner, token?: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const navigate = useNavigate();
  const [selectedUser, setSelectedUser] = useState<Practitioner | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const users = useStore(state => state.practitionersList);

  const handleUserSelect = (user: Practitioner) => {
      setSelectedUser(user);
      setPin('');
      setError('');
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedUser) return;

      try {
          const response = await fetch('/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: selectedUser.id, pin: pin })
          });
          
          if (!response.ok) {
              const data = await response.json();
              setError(data.error || 'Nesprávný PIN.');
              setPin('');
              return;
          }

          const data = await response.json();
          onLogin(selectedUser, data.token);
      } catch (err) {
          setError('Vyskytla se chyba při přihlašování.');
          setPin('');
      }
  };

  const handleBack = () => {
      setSelectedUser(null);
      setPin('');
      setError('');
  };

  // Filter out admin if you want, or keep him. Usually managers also book rooms.
  const activeUsers = users.filter(p => p.isActive !== false);

  return (
    <div className="min-h-screen bg-[#f1e9dc] flex flex-col items-center justify-center px-4 relative animate-in fade-in duration-700">
      
      {/* Logo & Branding */}
      <div className="mb-12 text-center mt-8">
          <div className="w-24 h-24 bg-white rounded-full mx-auto mb-4 shadow-xl border-4 border-stone-200/50 flex items-center justify-center p-2 relative overflow-hidden">
             <img 
                 src="/logo.png?v=2" 
                 alt="Centrum Unity Logo" 
                 className="w-full h-full object-contain"
             />
             <Leaf className="w-10 h-10 text-sage-500 hidden" />
          </div>
          <h1 className="text-4xl font-bold text-stone-900 font-logo tracking-tight">Centrum Unity</h1>
          <p className="text-stone-500 text-sm uppercase font-bold tracking-widest mt-2">Coworking Space</p>
      </div>

      {!selectedUser ? (
        // STAGE 1: PROFILE SELECTOR
        <div className="w-full max-w-4xl pb-12">
            <h2 className="text-center text-xl text-stone-600 mb-8 font-medium">Kdo právě přichází?</h2>
            
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6 justify-center">
                {activeUsers.map((user: Practitioner) => (
                    <button 
                        key={user.id}
                        onClick={() => handleUserSelect(user)}
                        className="group flex flex-col items-center gap-3 p-4 rounded-xl transition-all hover:bg-white/40 hover:scale-105 hover:shadow-lg focus:outline-none"
                    >
                        <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-stone-200/50 shadow-sm group-hover:border-sage-500 transition-colors relative bg-[#f8f5f0]">
                            <img src={user.imageUrl} alt={user.name} className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500" />
                            {user.role === Role.ADMIN && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-xs text-white font-bold uppercase">Admin</span>
                                </div>
                            )}
                        </div>
                        <span className="font-bold text-stone-600 group-hover:text-stone-900 text-lg">{user.name}</span>
                    </button>
                ))}
            </div>
        </div>
      ) : (
        // STAGE 2: PIN ENTRY
        <div className="w-full max-w-sm bg-white/70 backdrop-blur-md p-8 rounded-2xl shadow-xl border border-white/50 relative animate-in zoom-in-95 duration-300">
            <button 
                onClick={handleBack}
                className="absolute top-4 right-4 p-2 hover:bg-stone-200/50 rounded-full text-stone-400 hover:text-stone-600 transition-colors"
            >
                <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center mb-6">
                <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-sage-500 mb-4 shadow-md bg-[#f8f5f0]">
                    <img src={selectedUser.imageUrl} alt={selectedUser.name} className="w-full h-full object-cover" />
                </div>
                <h2 className="text-xl font-bold text-stone-900">Ahoj, {selectedUser.name}!</h2>
                <p className="text-stone-600 text-sm">Zadejte svůj PIN pro vstup</p>
            </div>

            <form onSubmit={handlePinSubmit} className="space-y-6">
                <div>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 w-5 h-5" />
                        <input 
                            type="password" 
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-white/80 border border-stone-200/80 rounded-xl text-center text-2xl font-bold tracking-[0.5em] text-stone-900 focus:ring-2 focus:ring-sage-500 outline-none transition-all shadow-sm"
                            placeholder="••••"
                            maxLength={4}
                            autoFocus
                        />
                    </div>
                    {error && <p className="text-red-500 text-xs mt-2 text-center font-bold">{error}</p>}
                </div>

                <Button type="submit" className="w-full py-3 bg-sage-600 hover:bg-sage-700 text-white shadow-md border-0">
                    Vstoupit <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
            </form>
        </div>
      )}
      
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-stone-400 text-xs text-center w-full">
          © 2026 Centrum Unity
      </div>
    </div>
  );
};

export default Login;