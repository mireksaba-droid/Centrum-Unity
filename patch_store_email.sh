sed -i 's/const emailTarget = newBooking.clientEmail;/const emailTarget = newBooking.clientEmail || (newBooking.bookedByUserId !== "guest" ? "mirek.saba@gmail.com" : null);/g' store/useStore.ts
