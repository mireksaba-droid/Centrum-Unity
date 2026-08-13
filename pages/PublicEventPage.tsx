import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GroupEvent, EventRegistration } from '../types';
import { Calendar, Clock, MapPin, Users, CheckCircle, AlertCircle } from 'lucide-react';
import { formatLocalDate } from '../utils/dateUtils';
import Button from '../components/Button';
import { useToast } from '../contexts/ToastContext';

interface PublicEventPageProps {
  events: GroupEvent[];
  registrations: EventRegistration[];
  onRegister: (registration: Partial<EventRegistration>) => Promise<{ success: boolean; paymentUrl?: string }>;
}

const PublicEventPage: React.FC<PublicEventPageProps> = ({ events, registrations, onRegister }) => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  React.useEffect(() => {
    const queryStr = window.location.search || (window.location.hash.includes('?') ? window.location.hash.substring(window.location.hash.indexOf('?')) : '');
    const params = new URLSearchParams(queryStr);
    if (params.get('status') === 'success' || params.get('id')) {
      setIsSuccess(true);
    }
  }, []);

  const event = events.find(e => e.id === eventId);
  
  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-stone-900">Událost nenalezena</h1>
          <p className="text-stone-500 mt-2">Tato událost neexistuje nebo již byla smazána.</p>
          <Button className="mt-6" onClick={() => navigate('/')}>Zpět na hlavní stránku</Button>
        </div>
      </div>
    );
  }

  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState<string>(() => {
    return event.ticketTypes && event.ticketTypes.length > 0 ? event.ticketTypes[0].id : '';
  });

  React.useEffect(() => {
    if (event.ticketTypes && event.ticketTypes.length > 0) {
      setSelectedTicketTypeId(event.ticketTypes[0].id);
    } else {
      setSelectedTicketTypeId('');
    }
  }, [event]);

  const currentRegistrations = registrations.filter(r => r.eventId === event.id && r.paymentStatus !== 'cancelled').reduce((acc, curr) => acc + (curr.ticketTypeSpots || 1), 0);
  
  const selectedTicketType = event.ticketTypes?.find(t => t.id === selectedTicketTypeId);
  const selectedSpots = selectedTicketType ? (selectedTicketType.spots || 1) : 1;
  const priceToDisplay = selectedTicketType ? selectedTicketType.price : event.price;
  
  const isFull = currentRegistrations >= event.capacity;
  const isTicketFull = (currentRegistrations + selectedSpots) > event.capacity;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isTicketFull) {
      addToast('error', 'Kapacita naplněna', 'Pro tuto variantu vstupenky již není v sále dostatek míst.');
      return;
    }

    setIsSubmitting(true);
    
    const result = await onRegister({
      eventId: event.id,
      clientName: name,
      clientEmail: email,
      clientPhone: phone,
      paymentStatus: 'unpaid',
      registeredAt: new Date().toISOString(),
      ticketTypeId: selectedTicketTypeId || undefined
    });

    setIsSubmitting(false);

    if (result.success) {
      if (result.paymentUrl) {
        addToast('success', 'Přihlášení úspěšné', 'Nyní budete přesměrováni na platební bránu GoPay k dokončení platby.');
        setTimeout(() => {
          const opened = window.open(result.paymentUrl, '_blank');
          if (!opened) {
            window.location.href = result.paymentUrl!;
          }
        }, 1000);
      } else {
        setIsSuccess(true);
        addToast('success', 'Přihlášení úspěšné', 'Těšíme se na vás!');
      }
    } else {
      addToast('error', 'Chyba', 'Nepodařilo se přihlásit. Zkuste to prosím znovu.');
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center animate-in zoom-in-95 duration-500">
          <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-stone-900 mb-2">Jste přihlášeni!</h1>
          <p className="text-stone-500 mb-6">
            Vaše místo na lekci <strong>{event.title}</strong> je zarezervováno. Potvrzení jsme vám zaslali na e-mail.
          </p>
          <Button className="w-full" onClick={() => window.location.href = 'https://centrumunity.cz'}>
            Zpět na web studia
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-stone-900 font-heading mb-4">{event.title}</h1>
          <p className="text-lg text-stone-500">{event.description || 'Skupinová lekce v Centru Unity'}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row">
          {/* Event Details */}
          <div className="bg-indigo-900 text-white p-8 md:w-1/2 flex flex-col justify-between">
            <div>
              <h3 className="text-xl font-bold mb-6 text-indigo-100">Detaily události</h3>
              
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <Calendar className="w-6 h-6 text-indigo-300 shrink-0" />
                  <div>
                    <div className="font-bold">{formatLocalDate(event.date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
                    <div className="text-indigo-200 text-sm">Datum konání</div>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <Clock className="w-6 h-6 text-indigo-300 shrink-0" />
                  <div>
                    <div className="font-bold">{event.startTime} - {event.endTime}</div>
                    <div className="text-indigo-200 text-sm">Čas konání</div>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <MapPin className="w-6 h-6 text-indigo-300 shrink-0" />
                  <div>
                    <div className="font-bold">Velká místnost (Sál)</div>
                    <div className="text-indigo-200 text-sm">Centrum Unity</div>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <Users className="w-6 h-6 text-indigo-300 shrink-0" />
                  <div>
                    <div className="font-bold">{currentRegistrations} / {event.capacity} obsazeno</div>
                    <div className="text-indigo-200 text-sm">Kapacita</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-12 pt-6 border-t border-indigo-800">
              <div className="text-indigo-200 text-sm mb-1">
                {event.ticketTypes && event.ticketTypes.length > 0 ? 'Vybrané vstupné' : 'Cena za osobu'}
              </div>
              <div className="text-3xl font-bold">{priceToDisplay} Kč</div>
              {selectedTicketType && (
                <div className="text-indigo-300 text-sm mt-1">({selectedTicketType.name})</div>
              )}
            </div>
          </div>

          {/* Registration Form */}
          <div className="p-8 md:w-1/2">
            <h3 className="text-xl font-bold text-stone-900 mb-6">Přihláška</h3>
            
            {isFull ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                <h4 className="font-bold text-red-800 mb-1">Kapacita naplněna</h4>
                <p className="text-sm text-red-600">Omlouváme se, ale tato událost je již plně obsazena.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {event.ticketTypes && event.ticketTypes.length > 0 && (
                  <div className="bg-stone-50 p-4 rounded-xl border border-stone-200 mb-4">
                    <label className="block text-sm font-bold text-stone-700 mb-2">Vyberte variantu vstupenky *</label>
                    <div className="space-y-2">
                      {event.ticketTypes.map(ticket => {
                        const tSpots = ticket.spots || 1;
                        const isUnavailable = (currentRegistrations + tSpots) > event.capacity;
                        return (
                          <label 
                            key={ticket.id} 
                            className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                              selectedTicketTypeId === ticket.id 
                                ? 'border-indigo-600 bg-indigo-50/50' 
                                : isUnavailable 
                                  ? 'border-stone-200 bg-stone-100 opacity-60 cursor-not-allowed' 
                                  : 'border-stone-200 hover:bg-stone-50'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input 
                                type="radio" 
                                name="ticketType"
                                disabled={isUnavailable}
                                checked={selectedTicketTypeId === ticket.id}
                                onChange={() => setSelectedTicketTypeId(ticket.id)}
                                className="text-indigo-600 focus:ring-indigo-500"
                              />
                              <div className="text-left">
                                <div className="font-semibold text-sm text-stone-900">{ticket.name}</div>
                                <div className="text-xs text-stone-500">
                                  {tSpots === 1 ? 'Obsadí 1 místo' : `Obsadí ${tSpots} místa`}
                                </div>
                              </div>
                            </div>
                            <div className="font-bold text-indigo-700">{ticket.price} Kč</div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-bold text-stone-700 mb-1">Jméno a Příjmení *</label>
                  <input 
                    type="text" 
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="Např. Jana Nováková"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-stone-700 mb-1">E-mail *</label>
                  <input 
                    type="email" 
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="jana@email.cz"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-stone-700 mb-1">Telefon</label>
                  <input 
                    type="tel" 
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="+420 777 123 456"
                  />
                </div>

                <div className="pt-4">
                  <Button 
                    type="submit" 
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 text-lg"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Zpracovávám...' : 'Závazně se přihlásit'}
                  </Button>
                  <p className="text-xs text-stone-400 text-center mt-3">
                    Kliknutím souhlasíte se storno podmínkami studia. U placených lekcí probíhá platba online přes GoPay.
                  </p>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicEventPage;
