import { Practitioner, Service, Booking, Role } from './types';

// Dynamic Cleaning Logic
export const BUFFER_SAME_USER = 30;
export const BUFFER_DIFF_USER = 60;
export const CLEANING_BUFFER_MINUTES = 30; // Default cleaning buffer

// Centralized time slots with 30-minute granularity
export const GENERATED_TIMES = [
  '08:00', '08:30',
  '09:00', '09:30', 
  '10:00', '10:30', 
  '11:00', '11:30', 
  '12:00', '12:30',
  '13:00', '13:30', 
  '14:00', '14:30', 
  '15:00', '15:30', 
  '16:00', '16:30', 
  '17:00', '17:30', 
  '18:00', '18:30', 
  '19:00', '19:30',
  '20:00', '20:30',
  '21:00', '21:30',
  '22:00', '22:30',
  '23:00', '23:30'
];

export const RENTAL_PRICING = {
    room1: 350, // Kč per hour
    room2: 350  // Kč per hour
};

export const CATEGORIES = ['Vše', 'Terapie', 'Masáže', 'Fyzio', 'Koučink', 'Jóga', 'Pronájem prostor', 'Management'];

export const RAW_PRACTITIONERS: Practitioner[] = [
  {
    id: 'karolina',
    name: 'Karolína',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Karolina.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Karolína.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1234',
    colorCode: 'bg-emerald-500'
  },
  {
    id: 'admin',
    name: 'Eva',
    title: 'Manažerka Studia',
    category: 'Management',
    imageUrl: '/manager.jpg',
    rating: 0,
    reviewCount: 0,
    description: 'Správa studia.',
    specialties: ['Management'],
    availability: [],
    services: [],
    role: Role.ADMIN,
    isActive: true,
    pin: '0000',
    colorCode: 'bg-stone-500'
  },
  {
    id: 'guest',
    name: 'Host / Externista',
    title: 'Jednorázový vstup',
    category: 'Pronájem prostor',
    imageUrl: 'https://images.unsplash.com/photo-1511367461989-f85a21fda167?auto=format&fit=crop&q=80&w=400',
    rating: 0,
    reviewCount: 0,
    description: 'Profil pro externí lektory a jednorázové rezervace.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1111',
    colorCode: 'bg-slate-500'
  },
  {
    id: 'filip',
    name: 'Filip',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Filip.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Filip.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1234',
    colorCode: 'bg-red-500'
  },
  {
    id: 'pavel_s',
    name: 'Pavel S.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/PavelS.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Pavel S..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1245',
    colorCode: 'bg-orange-500'
  },
  {
    id: 'tereza_k',
    name: 'Tereza K.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/TerezaK.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Tereza K..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1256',
    colorCode: 'bg-amber-500'
  },
  {
    id: 'adam_r',
    name: 'Adam R.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Adam R..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1267',
    colorCode: 'bg-green-500'
  },
  {
    id: 'alena_b',
    name: 'Alena B.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Alena_B.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Alena B..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1278',
    colorCode: 'bg-emerald-500'
  },
  {
    id: 'alžběta_m',
    name: 'Alžběta M.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Alžběta M..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1289',
    colorCode: 'bg-teal-500'
  },
  {
    id: 'aneta_b',
    name: 'Aneta B.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Aneta B..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1300',
    colorCode: 'bg-cyan-500'
  },
  {
    id: 'irena',
    name: 'Irena',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Irena.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1311',
    colorCode: 'bg-sky-500'
  },
  {
    id: 'barbora_pt',
    name: 'Barbora PT',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/BarboraPT.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Barbora PT.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1322',
    colorCode: 'bg-blue-500'
  },
  {
    id: 'tobi',
    name: 'Tobi',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Tobi.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1333',
    colorCode: 'bg-indigo-500'
  },
  {
    id: 'b_ra_v',
    name: 'Bára V.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/BaraV.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Bára V..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1344',
    colorCode: 'bg-violet-500'
  },
  {
    id: 'jaspit',
    name: 'Jaspit',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Jaspit.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1355',
    colorCode: 'bg-purple-500'
  },
  {
    id: 'lucka_j',
    name: 'Lucka J.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Lucka J..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1366',
    colorCode: 'bg-fuchsia-500'
  },
  {
    id: 'magda',
    name: 'Magda',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Magda.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1377',
    colorCode: 'bg-pink-500'
  },
  {
    id: 'viktorie_j',
    name: 'Viktorie J.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Viktorie.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Viktorie J..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1388',
    colorCode: 'bg-rose-500'
  },
  {
    id: 'karel_keaya',
    name: 'Karel Keaya',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Karel Keaya.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1399',
    colorCode: 'bg-red-500'
  },
  {
    id: 'kl_ra_k_mt',
    name: 'Klára K. MT',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Klára K. MT.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1410',
    colorCode: 'bg-orange-500'
  },
  {
    id: 'kristina_t',
    name: 'Kristina T.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Kristyna_T.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Kristina T..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1421',
    colorCode: 'bg-amber-500'
  },
  {
    id: 'iva_l',
    name: 'Iva L.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/IvaL.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Iva L..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1432',
    colorCode: 'bg-green-500'
  },
  {
    id: 'iveta_h',
    name: 'Iveta H.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Iveta H..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1443',
    colorCode: 'bg-emerald-500'
  },
  {
    id: 'hanka_mt',
    name: 'Hanka MT',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Hanka.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Hanka MT.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1454',
    colorCode: 'bg-teal-500'
  },
  {
    id: 'k_ja_mt',
    name: 'Kája MT',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Kája MT.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1465',
    colorCode: 'bg-cyan-500'
  },
  {
    id: 'moana',
    name: 'Moana',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Moana.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Moana.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1476',
    colorCode: 'bg-sky-500'
  },
  {
    id: 'zuzka_b',
    name: 'Zuzka B.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Zuzka B..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1487',
    colorCode: 'bg-blue-500'
  },
  {
    id: 'krist_na_pt',
    name: 'Kristýna PT',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Kristyna_PT.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Kristýna PT.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1498',
    colorCode: 'bg-indigo-500'
  },
  {
    id: 'radka',
    name: 'Radka',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Radka.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Radka.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1509',
    colorCode: 'bg-violet-500'
  },
  {
    id: 'jana_p',
    name: 'Jana P.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/JanaP.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Jana P..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1520',
    colorCode: 'bg-purple-500'
  },
  {
    id: 'sabina_pt',
    name: 'Sabina PT',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/SabinaPT.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Sabina PT.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1531',
    colorCode: 'bg-fuchsia-500'
  },
  {
    id: 'pavla_s',
    name: 'Pavla S.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Pavla S..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1542',
    colorCode: 'bg-pink-500'
  },
  {
    id: 'michaela_l',
    name: 'Michaela L.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/MichaelaL.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Michaela L..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1553',
    colorCode: 'bg-rose-500'
  },
  {
    id: 'zuzka_š',
    name: 'Zuzka Š.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/ZuzkaS.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Zuzka Š..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1564',
    colorCode: 'bg-red-500'
  },
  {
    id: 'david_b',
    name: 'David B.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora David B..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1575',
    colorCode: 'bg-orange-500'
  },
  {
    id: 'jana_s',
    name: 'Jana S.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Jana S..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1586',
    colorCode: 'bg-amber-500'
  },
  {
    id: 'blanka',
    name: 'Blanka',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Blanka.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Blanka.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1597',
    colorCode: 'bg-green-500'
  },
  {
    id: 'jana_b',
    name: 'Jana B.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/JanaB.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Jana B..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1608',
    colorCode: 'bg-emerald-500'
  },
  {
    id: 'nina_hakima',
    name: 'Nina Hakima',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Nina Hakima.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1619',
    colorCode: 'bg-teal-500'
  },
  {
    id: 'pavel_m',
    name: 'Pavel M.',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Pavel_M.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Pavel M..',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1630',
    colorCode: 'bg-cyan-500'
  },
  {
    id: 'štěp_nka',
    name: 'Štěpánka',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Štěpánka.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1641',
    colorCode: 'bg-sky-500'
  },
  {
    id: 'tom_š_kohoutek',
    name: 'Tomáš Kohoutek',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Tomáš Kohoutek.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1652',
    colorCode: 'bg-blue-500'
  },
  {
    id: 'kamila',
    name: 'Kamila',
    title: 'Lektor',
    category: 'Jiné',
    imageUrl: '/Kamila.jpg',
    rating: 5.0,
    reviewCount: 0,
    description: 'Profil lektora Kamila.',
    specialties: [],
    availability: [],
    services: [],
    role: Role.PRACTITIONER,
    isActive: true,
    pin: '1663',
    colorCode: 'bg-indigo-500'
  }

];

export const sortPractitioners = (practitioners: Practitioner[]): Practitioner[] => {
  return [...practitioners].sort((a, b) => {
    const getPriority = (id: string) => {
      if (id === 'admin') return 1;
      if (id === 'guest') return 2;
      if (id === 'filip') return 3;
      return 4;
    };

    const priorityA = getPriority(a.id);
    const priorityB = getPriority(b.id);

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    const aHasImg = a.imageUrl && !a.imageUrl.includes('unsplash.com') && a.imageUrl.length > 5;
    const bHasImg = b.imageUrl && !b.imageUrl.includes('unsplash.com') && b.imageUrl.length > 5;

    if (aHasImg && !bHasImg) return -1;
    if (!aHasImg && bHasImg) return 1;

    return a.name.localeCompare(b.name);
  });
};

export const PRACTITIONERS = sortPractitioners(RAW_PRACTITIONERS);

// --- SEED DATA GENERATOR ---
export const generateMockBookings = (): Booking[] => {
    const bookings: Booking[] = [];
    const activePractitioners = PRACTITIONERS.filter(p => p.role !== Role.ADMIN && p.id !== 'guest');
    
    activePractitioners.forEach(p => {
        const count = Math.floor(Math.random() * 5) + 2; 
        
        for (let i = 0; i < count; i++) {
            const date = new Date();
            // Random day +/- 7 days
            const offset = Math.floor(Math.random() * 14) - 7;
            date.setDate(date.getDate() + offset);
            
            const time = GENERATED_TIMES[Math.floor(Math.random() * (GENERATED_TIMES.length - 4))]; // Avoid late hours for seed
            const duration = Math.random() > 0.5 ? 60 : 90;
            const room = Math.random() > 0.7 ? 2 : 1; // Room 2 is scarce
            
            // Calculate price based on room
            const price = (duration / 60) * (room === 1 ? RENTAL_PRICING.room1 : RENTAL_PRICING.room2);

            bookings.push({
                id: `seed-${p.id}-${i}`,
                bookedByUserId: p.id,
                bookedByName: p.name,
                serviceName: 'Konzultace/Pronájem', // Mock service
                equipment: Math.random() > 0.5 ? 'table' : 'futon', // Mock equipment
                date: date.toISOString().split('T')[0],
                time: time,
                durationMinutes: duration,
                status: 'paid',
                price: Math.round(price),
                paymentMethod: 'invoice',
                room: room as 1 | 2,
                clientName: Math.random() > 0.5 ? 'Jan Novák' : undefined,
                createdAt: new Date().toISOString()
            });
        }
    });

    return bookings;
};