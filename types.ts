
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
  email?: string; // E-mail lektora - sem chodí potvrzení o rezervaci/platbě a storno
  colorCode?: string; // Phase 1.5: Barevné kódování v kalendáři (např. '#10b981' nebo 'bg-emerald-500')
  calendarSyncToken?: string; // Phase 1.5: Bezpečnostní token pro iCal/ICS feed (export do telefonu)
}

export type BookingStatus = 'created' | 'awaiting_payment' | 'deferred_payment' | 'paid' | 'cancelled' | 'completed' | 'refunded' | 'payment_review';

export interface Booking {
  id: string;
  bookedByUserId: string; // ID lektora, který si místnost pronajal
  bookedByName: string;   // Jméno lektora
  
  // Expanded fields for dashboard compatibility and CRM
  serviceName?: string;
  equipment?: 'table' | 'futon' | 'none';
  
  date: string; // ISO date string "YYYY-MM-DD"
  time: string; // "HH:MM"
  durationMinutes: number;
  
  status: BookingStatus;
  price: number; // Cena pronájmu, kterou lektor dluží studiu
  paymentMethod: 'invoice' | 'qr' | 'online';
  
  room: 1 | 2; // 1 = Malá, 2 = Velká
  
  // Optional Client Data (CRM for the practitioner)
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  note?: string; 
  
  cancelledAt?: string; // ISO date string
  cancellationReason?: string; // Proč byla rezervace zrušena (payment_expired, payment_cancelled, cancelled_by_guest, cancelled_by_admin, ...)
  
  paymentId?: string; // Pro refundace testovacích nebo skutečných plateb před uplynutím termínu

  createdAt: string;
  paidAt?: string; // Kdy byla rezervace reálně zaplacena (pro finanční přehled a shodu s GoPay)
  paymentRequestedAt?: string; // Kdy byla odeslána výzva k platbě (od tohoto času se počítá okno na platbu)
  reminderSentAt?: string; // Kdy byla odeslána připomínka platby (aby se poslala jen jednou)
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
export interface TicketType {
  id: string;
  name: string;
  price: number;
  spots: number; // Kolik míst v kapacitě tato vstupenka zabírá
}

export interface GroupEvent {
  id: string;
  title: string;
  description?: string;
  practitionerId: string; // Kdo akci vede
  practitionerName?: string; // Jméno lektora
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  capacity: number; // Maximální počet účastníků
  price: number; // Cena za osobu (výchozí základní cena)
  ticketTypes?: TicketType[]; // Novinka: Více variant vstupenek
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
  paymentStatus: 'paid' | 'unpaid' | 'awaiting_payment' | 'cancelled';
  registeredAt: string;
  paymentId?: string;
  paymentUrl?: string;
  ticketTypeId?: string; // ID vybrané varianty vstupenky
  ticketTypeName?: string; // Název vybrané varianty vstupenky
  ticketTypePrice?: number; // Cena v době nákupu
  ticketTypeSpots?: number; // Kolik míst tato varianta zabrala
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}
