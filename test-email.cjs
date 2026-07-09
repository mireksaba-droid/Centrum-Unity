const jwt = require("jsonwebtoken");
const token = jwt.sign({ id: "filip", role: "practitioner" }, "default_dev_secret_key", { expiresIn: "1h" });
fetch("http://localhost:3000/api/send-email", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + token
  },
  body: JSON.stringify({
    to: "mirek.saba@gmail.com",
    subject: "Test e-mail z AI Studia",
    html: "<h1>Funguje to!</h1><p>Toto je test SMTP serveru.</p>"
  })
}).then(r => r.text()).then(console.log).catch(console.error);
