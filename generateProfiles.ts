import * as fs from 'fs';

const names = ['Klára', 'Martin', 'Eliška', 'David', 'Zuzana', 'Petr', 'Jana', 'Tomáš', 'Lucie', 'Ondřej', 'Veronika', 'Jakub', 'Barbora', 'Adam', 'Michaela', 'Matěj', 'Kateřina', 'Vojtěch', 'Lenka', 'František', 'Eva', 'Kryštof', 'Petra', 'Marek', 'Anna', 'Lukáš', 'Markéta', 'Jiří', 'Adéla', 'Štěpán', 'Tereza', 'Karel', 'Nikola', 'Patrik', 'Hana'];
const categoriesAndTitles = [
    {category: 'Masáže', title: 'Masér'},
    {category: 'Fyzio', title: 'Fyzioterapeut'},
    {category: 'Koučink', title: 'Kouč'},
    {category: 'Jóga', title: 'Lektor jógy'},
    {category: 'Terapie', title: 'Psychoterapeut'},
];
const colors = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-green-500', 'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500', 'bg-rose-500'];

const practitioners = names.map((name, i) => {
    const ct = categoriesAndTitles[i % categoriesAndTitles.length];
    const color = colors[i % colors.length];
    const id = name.toLowerCase().replace(/ /g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return `  {
    id: '${id}',
    name: '${name}',
    title: '${ct.title}',
    category: '${ct.category}',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 10,
    description: 'Profil lektora ${name}.',
    specialties: ['${ct.category}'],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1234',
    colorCode: '${color}'
  }`;
});

const content = fs.readFileSync('constants.ts', 'utf8');

// The end of PRACTITIONERS array looks like this in constants.ts:
//     pin: '1234'
//   }
// ];

// Wait, looking at the file `constants.ts` line 140 it's Magda
const match = /name: 'Magda',[\s\S]*?pin: '1234'(\s*)}/g;
const injectedRegex = /];\s*\/\/\s*---\s*SEED DATA GENERATOR/;

let parts = content.split('];');
if (parts.length > 1) {
    const mainParts = parts.slice(0, parts.length - 1).join('];');
    const tail = parts[parts.length - 1]; // contains " --- SEED DATA GENERATOR ---"
    
    // Check where the array ends.
    // Let's rely on string replace of a known substring.
}

const findEnd = /    pin: '1234'\s*\}\s*\];/g;
if (findEnd.test(content)) {
    const modified = content.replace(findEnd, "    pin: '1234'\n  },\n" + practitioners.join(',\n') + "\n];");
    fs.writeFileSync('constants.ts', modified);
    console.log('Appended 35 profiles.');
} else {
    console.error('Could not find the end of PRACTITIONERS array. Let\'s try another match.');
    // Let's just find "];" before "// --- SEED DATA GENERATOR ---"
    const fallbackMatch = /\];\s*\/\/\s*---\s*SEED DATA GENERATOR/;
    if (fallbackMatch.test(content)) {
         const modified = content.replace(fallbackMatch, ",\n" + practitioners.join(',\n') + "\n];\n\n// --- SEED DATA GENERATOR");
         fs.writeFileSync('constants.ts', modified);
         console.log('Appended using fallback match.');
    } else {
         console.error('Failed completely.');
    }
}
