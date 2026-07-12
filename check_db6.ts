import { loadPractitioners } from './services/firebase';
import { PRACTITIONERS } from './constants';

async function run() {
  const list = await loadPractitioners();
  const dbIds = new Set(list.map(p => p.id));
  const constIds = new Set(PRACTITIONERS.map(p => p.id));
  for (const p of PRACTITIONERS) {
    if (!dbIds.has(p.id)) {
      console.log("Missing in DB:", p.id, p.name);
    }
  }
}
run();
