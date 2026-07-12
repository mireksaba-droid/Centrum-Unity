import "dotenv/config";
async function test() {
  const gopayId = process.env.GOPAY_GOID;
  const clientId = process.env.GOPAY_CLIENT_ID;
  const clientSecret = process.env.GOPAY_CLIENT_SECRET;
  
  const GOPAY_URL = process.env.GOPAY_API_URL || "https://gw.sandbox.gopay.com/api";
  console.log("URL:", GOPAY_URL);

  const response = await fetch(`${GOPAY_URL}/oauth2/token`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    },
    body: "grant_type=client_credentials&scope=payment-all"
  });
  
  const text = await response.text();
  console.log("Status:", response.status);
  console.log("Body:", text);
}
test();
