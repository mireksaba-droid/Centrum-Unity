import "dotenv/config";
console.log({
  gopayId: process.env.GOPAY_GOID,
  clientId: process.env.GOPAY_CLIENT_ID,
  clientSecret: process.env.GOPAY_CLIENT_SECRET
});
