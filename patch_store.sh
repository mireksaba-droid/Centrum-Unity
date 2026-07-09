sed -i '/set((state) => ({ bookings: \[...state.bookings, newBooking\] }));/a \
        // Odeslání potvrzovacího e-mailu pro ne-online platby\
        if (newBooking.paymentMethod !== "online" || newBooking.price === 0) {\
            const emailTarget = newBooking.clientEmail;\
            if (emailTarget) {\
                try {\
                    const html = generateConfirmationEmail(newBooking, newBooking.status === "paid" || newBooking.price === 0);\
                    sendTransactionalEmail({\
                        to: emailTarget,\
                        subject: "Potvrzení rezervace - Centrum Unity",\
                        text: "Potvrzení rezervace pro: " + newBooking.date + " v " + newBooking.time,\
                        html: html\
                    }).catch(e => console.error("Nepodařilo se odeslat potvrzovací e-mail:", e.message));\
                    console.log("Pokus o odeslání potvrzovacího e-mailu na:", emailTarget);\
                } catch (e: any) {\
                    console.error("Chyba při přípravě e-mailu:", e.message);\
                }\
            }\
        }
' store/useStore.ts
