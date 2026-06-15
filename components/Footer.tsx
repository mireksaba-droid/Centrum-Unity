import React from 'react';
import { Link } from 'react-router-dom';
import { Mail, Phone, MapPin } from 'lucide-react';

export const Footer: React.FC = () => {
    return (
        <footer className="w-full bg-[#e6ddcf] border-t border-stone-200 py-12 mt-auto">
            <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8">
                
                {/* O nás / O webu */}
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                        <img src="/logo.png" alt="Centrum Unity Logo" className="w-8 h-8 rounded-full shadow-sm" />
                        <h3 className="text-lg font-heading font-bold text-stone-900">Centrum Unity</h3>
                    </div>
                    <p className="text-sm text-stone-600 leading-relaxed">
                        Centrum Unity – Coworking Space a prostor pro Váš růst. Poskytujeme zázemí pro masáže, energetické terapie, individuální sezení, workshopy a osobní rozvoj.
                    </p>
                </div>

                {/* Kontaktní a firemní údaje */}
                <div className="space-y-4">
                    <h3 className="text-lg font-heading font-bold text-stone-900">Kontaktní údaje</h3>
                    <ul className="text-sm text-stone-600 space-y-2">
                        <li className="flex items-start gap-2">
                            <span className="font-semibold text-stone-900">Firma:</span> 
                            <span>Eva Kadlecová - Centrum Unity</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="font-semibold text-stone-900">IČO:</span> 
                            <span>73750565</span>
                        </li>
                        <li className="flex items-start gap-2 mt-2">
                            <MapPin className="w-4 h-4 text-sage-600 mt-0.5 shrink-0" />
                            <span>Šmilovského 1268/9, Vinohrady<br/>Praha 2, 120 00</span>
                        </li>
                        <li className="flex items-center gap-2 mt-2">
                            <Mail className="w-4 h-4 text-sage-600 shrink-0" />
                            <a href="mailto:info@centrumunity.cz" className="hover:text-sage-700 transition-colors">info@centrumunity.cz</a>
                        </li>
                        <li className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-sage-600 shrink-0" />
                            <a href="tel:+420704003433" className="hover:text-sage-700 transition-colors">+420 704 003 433</a>
                        </li>
                    </ul>
                </div>

                {/* Důležité odkazy a Platby */}
                <div className="space-y-4">
                    <h3 className="text-lg font-heading font-bold text-stone-900">Informace</h3>
                    <ul className="text-sm text-stone-600 space-y-2 flex flex-col">
                        <Link to="/obchodni-podminky" className="hover:text-amber-700 transition-colors">Obchodní podmínky a Reklamační řád</Link>
                        <Link to="/ochrana-udaju" className="hover:text-amber-700 transition-colors">Zásady ochrany osobních údajů</Link>
                    </ul>

                    <div className="pt-4 border-t border-[#d8cfc0] mt-4">
                        <h4 className="text-xs font-bold text-stone-500 mb-2 uppercase tracking-wider">Bezpečné online platby</h4>
                        <div className="flex gap-2">
                            {/* Placeholder pro loga karet. Místo img můžeme dát text s icony. */}
                            <div className="h-8 w-12 bg-white rounded shadow-sm flex items-center justify-center text-xs font-bold text-blue-800">VISA</div>
                            <div className="h-8 w-12 bg-white rounded shadow-sm flex items-center justify-center text-xs font-bold text-red-600">MC</div>
                            <div className="h-8 w-16 bg-white rounded shadow-sm flex items-center justify-center text-xs font-bold text-stone-700">Apple Pay</div>
                            <div className="h-8 w-16 bg-white rounded shadow-sm flex items-center justify-center text-xs font-bold text-stone-700">G Pay</div>
                        </div>
                    </div>
                </div>

            </div>
            <div className="max-w-7xl mx-auto px-4 mt-12 pt-6 border-t border-[#d8cfc0] text-center text-xs text-stone-500">
                © 2026 Centrum Unity. Všechna práva vyhrazena.
            </div>
        </footer>
    );
};
