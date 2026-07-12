import { loadPractitioners } from './services/firebase';

async function run() {
  const list = await loadPractitioners();
  console.log("Count:", list.length);
}
run();
