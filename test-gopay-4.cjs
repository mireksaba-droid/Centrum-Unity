const jwt = require("jsonwebtoken");
const token = jwt.sign({ id: "filip", role: "practitioner" }, process.env.JWT_SECRET || "default_dev_secret_key", { expiresIn: "1h" });
fetch("http://localhost:3000/api/public-payment", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + token
  },
  body: JSON.stringify({
    duration: 60,
    room: 1,
    currency: 'CZK',
    reservationDate: '2026-10-10',
    reservationTime: '10:00',
    returnUrl: 'http://localhost:3000/schedule',
    bookingId: "temp"
  })
}).then(r => r.text()).then(console.log).catch(console.error);
