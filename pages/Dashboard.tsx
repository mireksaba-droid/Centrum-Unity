import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Booking } from '../types';
import { Calendar, Clock, CheckCircle, CreditCard, Wallet } from 'lucide-react';
import Button from '../components/Button';
import { formatLocalDate } from '../utils/dateUtils';

interface DashboardProps {
  bookings: Booking[];
}

const data = [
  { name: 'Po', score: 65 },
  { name: 'Út', score: 72 },
  { name: 'St', score: 68 },
  { name: 'Čt', score: 85 },
  { name: 'Pá', score: 90 },
  { name: 'So', score: 88 },
  { name: 'Ne', score: 95 },
];

const Dashboard: React.FC<DashboardProps> = ({ bookings }) => {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold text-stone-900 mb-2 font-heading">Vítejte zpět, Anno</h1>
        <p className="text-stone-600">Zde je přehled vaší wellness cesty.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Stats Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-stone-100 md:col-span-2">
          <h2 className="text-lg font-bold text-stone-900 mb-4 font-heading">Můj Wellness Skóre (Týdenní)</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#78716c'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#78716c'}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  cursor={{fill: '#f5f5f4'}}
                />
                <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                   {data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.score > 80 ? '#5ab293' : '#83cbb1'} />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="space-y-6">
            <div className="bg-sage-50 p-6 rounded-xl border border-sage-100">
                <h3 className="text-sage-800 font-semibold mb-1 font-heading">Nadcházející sezení</h3>
                <p className="text-3xl font-bold text-sage-900">{bookings.filter(b => b.status === 'confirmed').length}</p>
            </div>
            <div className="bg-orange-50 p-6 rounded-xl border border-orange-100">
                <h3 className="text-orange-800 font-semibold mb-1 font-heading">Absolvováno hodin</h3>
                <p className="text-3xl font-bold text-orange-900">12.5</p>
            </div>
        </div>
      </div>

      {/* Bookings List */}
      <div className="bg-white rounded-xl shadow-sm border border-stone-100 overflow-hidden">
        <div className="p-6 border-b border-stone-100">
          <h2 className="text-lg font-bold text-stone-900 font-heading">Moje Rezervace</h2>
        </div>
        <div className="divide-y divide-stone-100">
          {bookings.length === 0 ? (
            <div className="p-8 text-center text-stone-500">
              Zatím nemáte žádné rezervace.
            </div>
          ) : (
            bookings.map((booking) => (
              <div key={booking.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-stone-50 transition-colors">
                <div className="flex items-start gap-4">
                  <div className="bg-sage-100 p-3 rounded-lg text-sage-600">
                    <Calendar className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-stone-900 font-heading">{booking.practitionerName}</h3>
                    <div className="flex items-center gap-2 text-stone-500 text-sm mt-1">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {booking.time}</span>
                      <span>•</span>
                      <span>{formatLocalDate(booking.date)}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col md:flex-row items-end md:items-center gap-3">
                    <div className="text-right">
                        <span className="block font-bold text-stone-900">{booking.price} Kč</span>
                        <div className="flex items-center gap-1 text-xs mt-0.5">
                            {booking.paymentStatus === 'paid' ? (
                                <span className="text-green-600 flex items-center gap-1 font-medium">
                                    <CheckCircle className="w-3 h-3" /> Zaplaceno kartou
                                </span>
                            ) : (
                                <span className="text-orange-600 flex items-center gap-1 font-medium">
                                    <Wallet className="w-3 h-3" /> Platba na místě
                                </span>
                            )}
                        </div>
                    </div>
                    <Button variant="outline" size="sm">Detail</Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;