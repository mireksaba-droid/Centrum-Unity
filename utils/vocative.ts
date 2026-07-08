// Skloňování křestních jmen do 5. pádu (vokativ) pro oslovení v e-mailech.
// Heuristika + seznam výjimek. Když si funkce není jistá, vrátí jméno beze změny.

// Ruční výjimky (mají přednost před pravidly). Klíč = jméno malými písmeny.
const EXCEPTIONS: Record<string, string> = {
  // mužská jména s nepravidelným tvarem
  'pavel': 'Pavle',
  'karel': 'Karle',
  'petr': 'Petře',
  'jan': 'Jene',
  'honza': 'Honzo',
  'marek': 'Marku',
  'radek': 'Radku',
  'zdeněk': 'Zdeňku',
  'luděk': 'Luďku',
  'vašek': 'Vašku',
  'aleš': 'Aleši',
  'tomáš': 'Tomáši',
  'lukáš': 'Lukáši',
  'matěj': 'Matěji',
  'ondřej': 'Ondřeji',
  'jiří': 'Jiří',
  'josef': 'Josefe',
  'jakub': 'Jakube',
  'filip': 'Filipe',
};

// Ženská jména končící na souhlásku, která se NESKLOŇUJÍ (necháme beze změny).
const FEMALE_INDECLINABLE = new Set([
  'dagmar', 'ester', 'miriam', 'karin', 'ingrid', 'rút', 'ruth', 'nikol',
  'doris', 'rachel', 'sharon', 'carmen', 'ines', 'inéz',
]);

const isVowel = (ch: string) => 'aeiouyáéěíóúůý'.includes(ch.toLowerCase());

// Vokativ jednoho křestního jména
function nameToVocative(name: string): string {
  if (!name) return name;

  const lower = name.toLocaleLowerCase('cs-CZ');
  if (EXCEPTIONS[lower]) return EXCEPTIONS[lower];

  const last = lower.slice(-1);
  const last2 = lower.slice(-2);

  // Ženská + mužská jména na -a → -o (Eva→Evo, Jana→Jano, Honza→Honzo)
  if (last === 'a') {
    return name.slice(0, -1) + 'o';
  }

  // Jména na -e/-ě, -i/-í, -y/-ý, -o, -u, -ů → beze změny (Marie, Viktorie, Jiří, Hugo…)
  if ('eěiíyýouůé'.includes(last)) {
    return name;
  }

  // Zbývají jména končící na souhlásku
  if (FEMALE_INDECLINABLE.has(lower)) return name;

  // -ek → -ku (Marek→Marku), -el → -le (Pavel→Pavle) řeší většinou výjimky výše.
  if (last2 === 'ek') return name.slice(0, -2) + 'ku';

  // Měkké souhlásky a sykavky → přidáme -i (Tomáš→Tomáši, Ondřej→Ondřeji)
  if ('cčďjňřšťž'.includes(last)) return name + 'i';

  // -k, -g, -h, -ch → přidáme -u (Dominik→Dominiku, Oldřich→Oldřichu)
  if (last === 'k' || last === 'g' || last === 'h') return name + 'u';
  if (last2 === 'ch') return name + 'u';

  // -r po souhlásce → -ře (Petr→Petře); po samohlásce → -re (Dalibor→Dalibore)
  if (last === 'r') {
    const prev = lower.slice(-2, -1);
    return isVowel(prev) ? name + 'e' : name.slice(0, -1) + 'ře';
  }

  // Ostatní tvrdé souhlásky → přidáme -e (Filip→Filipe, David→Davide, Martin→Martine)
  return name + 'e';
}

/**
 * Vrátí oslovení ve 5. pádě. Skloní pouze křestní jméno (první slovo),
 * případné příjmení ponechá beze změny.
 * Např. "Eva" → "Evo", "Jan Novák" → "Jene Novák".
 */
export function toVocative(fullName?: string): string {
  if (!fullName) return '';
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  parts[0] = nameToVocative(parts[0]);
  return parts.join(' ');
}
