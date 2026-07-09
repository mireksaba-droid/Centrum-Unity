const jwt = require("jsonwebtoken");
const token = jwt.sign({ id: "filip", role: "practitioner" }, "default_dev_secret_key", { expiresIn: "1h" });
fetch("http://localhost:3000/api/create-payment", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + token
  },
  body: JSON.stringify({
    duration: 60,
    room: 1
  })
}).then(r => r.text()).then(console.log).catch(console.error);
