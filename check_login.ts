import "dotenv/config";
import { PRACTITIONERS } from "./constants";

for (const p of PRACTITIONERS) {
  if (p.imageUrl.includes("unsplash.com")) continue;
  console.log(`${p.name}: ${p.imageUrl}`);
}
