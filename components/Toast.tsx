import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(toast.id);
    }, 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onClose]);

  const styles = {
    success: 'bg-white border-l-4 border-emerald-500 text-stone-800',
    error: 'bg-white border-l-4 border-red-500 text-stone-800',
    info: 'bg-stone-800 text-white border-l-4 border-stone-600',
  };

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-emerald-500" />,
    error: <AlertCircle className="w-5 h-5 text-red-500" />,
    info: <Info className="w-5 h-5 text-stone-400" />,
  };

  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg shadow-xl border border-stone-100 min-w-[300px] max-w-md animate-in slide-in-from-right-10 fade-in duration-300 mb-3 ${styles[toast.type]}`}>
      <div className="flex-shrink-0 mt-0.5">{icons[toast.type]}</div>
      <div className="flex-1">
        <h4 className={`text-sm font-bold ${toast.type === 'info' ? 'text-white' : 'text-stone-900'}`}>{toast.title}</h4>
        {toast.message && <p className={`text-xs mt-1 ${toast.type === 'info' ? 'text-stone-300' : 'text-stone-500'}`}>{toast.message}</p>}
      </div>
      <button onClick={() => onClose(toast.id)} className="opacity-50 hover:opacity-100 transition-opacity">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default Toast;