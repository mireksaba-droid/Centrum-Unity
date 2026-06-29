
export enum Role {
  CLIENT = 'CLIENT', // Prepared for Phase 2 client portal
  PRACTITIONER = 'PRACTITIONER',
  ADMIN = 'ADMIN'
}

export interface Service {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  type: '1-1' | 'group' | 'rental'; 
  targetRoom?: 1 | 2; 
  maxCapacity?: number;
}

export interface Practitioner {
  id: string;
  name: string;
  title: string;
  category: string;
  imageUrl: string;
  rating: number;
  reviewCount: number;
  description: string;
  specialties: string[];
  availability?: string[]; // Phase 1.5: Pracovní doba (0 = Ne, 1 = Po...)
  services: Service[];
  role?: Role;
  isActive?: boolean;
  pin?: string; // New: Simple auth for coworking model
  colorCode?: string; // Phase 1.5: Barevné kódování v kalendáři (např. '#10b981' nebo 'bg-emerald-500')
  calendarSyncToken?: string; // Phase 1.5: Bezpečnostní token pro iCal/ICS feed (export do telefonu)
}

export interface Booking {
  id: string;
  bookedByUserId: string; // ID lektora, který si místnost pronajal
  bookedByName: string;   // Jméno lektora
  
  // Expanded fields for dashboard compatibility and CRM
  practitionerId?: string; // Alias for bookedByUserId or specific practitioner
  practitionerName?: string; // Alias for bookedByName
  serviceName?: string;
  equipment?: 'table' | 'futon';
  
  date: string; // ISO date string "YYYY-MM-DD"
  time: string; // "HH:MM"
  durationMinutes: number;
  
  status: 'confirmed' | 'cancelled';
  price: number; // Cena pronájmu, kterou lektor dluží studiu
  paymentStatus: 'paid' | 'unpaid' | 'invoice_pending' | 'pending' | 'pending_future';
  paymentMethod: 'invoice' | 'qr' | 'online';
  
  room: 1 | 2; // 1 = Malá, 2 = Velká
  
  // Optional Client Data (CRM for the practitioner)
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  note?: string; 
  
  cancelledAt?: string; // ISO date string
  
  paymentId?: string; // Pro refundace testovacích nebo skutečných plateb před uplynutím termínu
  
  createdAt: string;
  recurringGroupId?: string; // Phase 1.5: ID pro spojení opakujících se rezervací
}

// Phase 1.5: Čekací listina
export interface WaitlistEntry {
  id: string;
  room: 1 | 2;
  date: string;
  time: string;
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  createdAt: string;
}

// Nové modely pro Skupinové akce (Workshopy/Lekce)
export interface GroupEvent {
  id: string;
  title: string;
  description?: string;
  practitionerId: string; // Kdo akci vede
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  capacity: number; // Maximální počet účastníků
  price: number; // Cena za osobu
  room: 2; // Zatím natvrdo uzamčeno na Velkou místnost (2)
  createdAt: string;
  currentRegistrations?: number;
}

export interface EventRegistration {
  id: string;
  eventId: string; // Vazba na GroupEvent
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  paymentStatus: 'paid' | 'unpaid'; // Pro budoucí napojení platební brány
  registeredAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}
