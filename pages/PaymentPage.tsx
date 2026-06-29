import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { CreditCard, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import Button from '../components/Button';
import { formatLocalDate } from '../utils/dateUtils';

const PaymentPage: React.FC = () => {
    const { bookingId } = useParams<{ bookingId: string }>();
    const [searchParams] = useSearchParams();
    const paymentId = searchParams.get('id');
    const { bookings, updateBookingPaymentStatus, token } = useStore();
    
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusMessage, setStatusMessage] = useState<{type: 'success' | 'error' | 'info', text: string} | null>(null);

    const booking = bookings.find(b => b.id === bookingId);

    useEffect(() => {
        const verifyPayment = async () => {
            if (paymentId && booking && booking.paymentStatus !== 'paid') {
                setIsProcessing(true);
                try {
                    const response = await fetch(`/api/gopay/status?id=${paymentId}`);
                    const data = await response.json();
                    
                    if (data.state === 'PAID') {
                        await updateBookingPaymentStatus(booking.id, 'paid');
                        setStatusMessage({ type: 'success', text: 'Vaše platba proběhla úspěšně. Děkujeme!' });
                    } else if (data.state === 'CANCELED' || data.state === 'TIMEOUTED') {
                        setStatusMessage({ type: 'error', text: 'Platba byla zrušena nebo vypršela.' });
                    } else {
                        setStatusMessage({ type: 'info', text: 'Zpracováváme platbu, prosím čekejte...' });
                    }
                } catch (e) {
                    console.error("Verification failed", e);
                    setStatusMessage({ type: 'error', text: 'Nepodařilo se ověřit stav platby. Kontaktujte podporu.' });
                } finally {
                    setIsProcessing(false);
                }
            }
        };

        verifyPayment();
    }, [paymentId, booking, updateBookingPaymentStatus]);

    if (!booking) {
        return (
            <div className="min-h-screen bg-[#f1e9dc] flex items-center justify-center p-4">
                <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
                    <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-stone-900 mb-2">Rezervace nenalezena</h1>
                    <p className="text-stone-500">Tato rezervace pravděpodobně neexistuje nebo byla zrušena.</p>
                </div>
            </div>
        );
    }

    const handlePay = async () => {
        setIsProcessing(true);
        setStatusMessage(null);
        try {
            const response = await fetch('/api/public-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: booking.id,
                    duration: booking.durationMinutes,
                    room: booking.room,
                    currency: 'CZK',
                    reservationDate: booking.date,
                    reservationTime: booking.time,
                    returnUrl: window.location.origin + window.location.pathname
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error);

            if (data.gwUrl) {
                window.location.href = data.gwUrl; // Redirect to GoPay
            } else {
                throw new Error("Missing Gateway URL");
            }
        } catch (error: any) {
            console.error("Payment failed", error);
            setStatusMessage({ type: 'error', text: 'Nastala chyba při přesměrování na platební bránu.' });
            setIsProcessing(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#f1e9dc] flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full">
                <h1 className="text-2xl font-bold text-stone-900 mb-6 text-center">Úhrada rezervace</h1>
                
                <div className="bg-stone-50 rounded-xl p-4 mb-6 border border-stone-200">
                    <h3 className="font-bold text-stone-800 mb-4 border-b border-stone-200 pb-2">Shrnutí rezervace</h3>
                    <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                            <span className="text-stone-500">Lektor / Jméno:</span>
                            <span className="font-bold text-stone-900">{booking.clientName || booking.bookedByName}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-500">Termín:</span>
                            <span className="font-bold text-stone-900">{formatLocalDate(booking.date)} v {booking.time}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-500">Místnost:</span>
                            <span className="font-bold text-stone-900">{booking.room === 1 ? 'M1 (Malá)' : 'M2 (Velká)'} ({booking.durationMinutes} min)</span>
                        </div>
                        <div className="flex justify-between pt-3 border-t border-stone-200">
                            <span className="text-stone-900 font-bold">Celková částka:</span>
                            <span className="text-xl font-bold text-indigo-600">{booking.price} Kč</span>
                        </div>
                    </div>
                </div>

                {statusMessage && (
                    <div className={`p-4 rounded-xl mb-6 flex items-start gap-3 ${
                        statusMessage.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' :
                        statusMessage.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' :
                        'bg-blue-50 text-blue-800 border border-blue-200'
                    }`}>
                        {statusMessage.type === 'success' && <CheckCircle className="w-5 h-5 mt-0.5 shrink-0" />}
                        {statusMessage.type === 'error' && <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />}
                        {statusMessage.type === 'info' && <Loader2 className="w-5 h-5 mt-0.5 shrink-0 animate-spin" />}
                        <p className="text-sm font-medium leading-relaxed">{statusMessage.text}</p>
                    </div>
                )}

                {booking.paymentStatus === 'paid' ? (
                    <div className="text-center p-4 bg-green-50 rounded-xl border border-green-200">
                        <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
                        <h3 className="font-bold text-green-900">Platba byla úspěšná</h3>
                        <p className="text-sm text-green-700">Tato rezervace je již zaplacena. Děkujeme!</p>
                    </div>
                ) : (
                    <Button 
                        onClick={handlePay} 
                        disabled={isProcessing}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white flex justify-center items-center py-4"
                    >
                        {isProcessing ? (
                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        ) : (
                            <CreditCard className="w-5 h-5 mr-2" />
                        )}
                        {isProcessing ? 'Zpracovávám...' : 'Zaplatit online přes GoPay'}
                    </Button>
                )}
                
                <div className="mt-6 text-center">
                    <a href="/" className="text-sm text-stone-500 hover:text-indigo-600 font-medium">
                        Zpět na hlavní stránku
                    </a>
                </div>
            </div>
        </div>
    );
};

export default PaymentPage;
