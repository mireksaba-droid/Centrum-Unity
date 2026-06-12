import React, { useState } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';

export const StripeCheckout = ({ amount, onPaymentSuccess, onCancel }: { amount: number, onPaymentSuccess: () => void, onCancel: () => void }) => {
    const stripe = useStripe();
    const elements = useElements();
    const [isProcessing, setIsProcessing] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!stripe || !elements || !isReady) {
            return;
        }

        setIsProcessing(true);
        setErrorMessage(null);

        // Required for some Element implementations prior to confirm
        const { error: submitError } = await elements.submit();
        if (submitError) {
            setErrorMessage(submitError.message || 'Zkontrolujte zadané údaje.');
            setIsProcessing(false);
            return;
        }

        const { error, paymentIntent } = await stripe.confirmPayment({
            elements,
            redirect: 'if_required', // We handle success on this page
        });

        if (error) {
            setErrorMessage(error.message || 'Došlo k chybě při platbě.');
            setIsProcessing(false);
        } else if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'requires_capture')) {
            setIsProcessing(false);
            onPaymentSuccess();
        } else {
            setErrorMessage('Platba nebyla úspěšná. Zkuste to prosím znovu.');
            setIsProcessing(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <PaymentElement onReady={() => setIsReady(true)} />
            
            {errorMessage && (
                <div className="text-red-600 bg-red-50 p-3 rounded-lg text-sm">
                    {errorMessage}
                </div>
            )}

            <div className="flex gap-2 pt-2">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={isProcessing}
                    className="flex-1 py-3 px-4 bg-stone-100 text-stone-600 rounded-xl font-bold hover:bg-stone-200 transition-colors disabled:opacity-50"
                >
                    Zrušit
                </button>
                <button
                    type="submit"
                    disabled={!stripe || !isReady || isProcessing}
                    className="flex-1 py-3 px-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {isProcessing ? (
                        <>
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                            Zpracování...
                        </>
                    ) : (
                        `Zaplatit ${amount} Kč`
                    )}
                </button>
            </div>
        </form>
    );
};
