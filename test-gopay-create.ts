import "dotenv/config";
async function test() {
  const gopayId = process.env.GOPAY_GOID;
  const clientId = process.env.GOPAY_CLIENT_ID;
  const clientSecret = process.env.GOPAY_CLIENT_SECRET;
  
  const GOPAY_URL = process.env.GOPAY_API_URL || "https://gw.sandbox.gopay.com/api";

  const response = await fetch(`${GOPAY_URL}/oauth2/token`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    },
    body: "grant_type=client_credentials&scope=payment-all"
  });
  const auth = await response.json();
  const token = auth.access_token;

  const paymentData = {
    payer: {
        allowed_payment_instruments: ["PAYMENT_CARD"],
        default_payment_instrument: "PAYMENT_CARD",
    },
    amount: 105000, // 1050 CZK in haler
    currency: "CZK",
    order_number: "test-order-1",
    order_description: `Rezervace místnosti`,
    items: [{ name: `Pronájem místnosti`, amount: 105000, count: 1 }],
    callback: {
        return_url: "https://rezervace.centrumunity.cz/",
        notification_url: "https://rezervace.centrumunity.cz/api/gopay/notify"
    },
    target: {
        type: "ACCOUNT",
        goid: gopayId
    },
    additional_params: [
        { name: "bookingId", value: "123" }
    ]
  };

  const createRes = await fetch(`${GOPAY_URL}/payments/payment`, {
    method: "POST",
    headers: {
       "Accept": "application/json",
       "Content-Type": "application/json",
       "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(paymentData)
  });
  console.log("Create Status:", createRes.status);
  console.log("Create Body:", await createRes.text());
}
test();
