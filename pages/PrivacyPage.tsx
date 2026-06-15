import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PrivacyPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-[#f1e9dc] px-4 py-12 md:py-20 font-sans text-stone-800 animate-in fade-in">
            <div className="max-w-3xl mx-auto bg-white p-8 md:p-12 rounded-3xl shadow-xl border border-stone-100 relative">
                <button 
                    onClick={() => navigate(-1)}
                    className="absolute top-6 left-6 p-2 bg-stone-50 hover:bg-stone-100 rounded-full text-stone-400 hover:text-stone-600 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>

                <div className="text-center mb-10 mt-4">
                    <img src="/logo.png" alt="Logo" className="w-16 h-16 rounded-full mx-auto mb-4" />
                    <h1 className="text-3xl font-heading font-bold text-stone-900">Zásady ochrany osobních údajů</h1>
                </div>

                <div className="prose prose-stone max-w-none text-sm leading-relaxed">
                    <h3>Správce osobních údajů</h3>
                    <p>
                        Správcem vašich osobních údajů je podnikatelka <strong>Eva Kadlecová - Centrum Unity</strong>, IČO: 73750565, 
                        se sídlem Šmilovského 1268/9, Vinohrady, Praha 2 (dále jen "Poskytovatel").
                    </p>

                    <h3>Jaké údaje zpracováváme a proč</h3>
                    <p>Zpracováváme osobní údaje zadané při tvorbě rezervace na našich webových stránkách nebo při osobním kontaktu:</p>
                    <ul className="list-disc pl-5">
                        <li><strong>Jméno a příjmení:</strong> pro identifikaci v rezervacích.</li>
                        <li><strong>E-mail a telefonní číslo:</strong> k zaslání potvrzení o platbě, PIN kódu nebo vyúčtování.</li>
                        <li><strong>Fakturační údaje:</strong> jedná-li se o placenou službu, zpracováváme i platební a transakční historii nutnou pro účetní evidenci (dle zákonné povinnosti).</li>
                    </ul>

                    <h3>Účel zpracování</h3>
                    <p>
                        Základním důvodem zpracování je realizace a sjednání smlouvy o pronájmu prostoru/poskytnutí služeb (GDPR čl. 6 odst. 1 písm. b).<br/>
                        Navazujícím účelem je evidence pro plnění našich zákonných povinností – například vedení kompletního účetnictví.
                    </p>

                    <h3>Předávání údajů třetím stranám</h3>
                    <p>
                        Informace mohou být předávány zpracovatelům pro účely výkonu smlouvy (např. poskytovatel rezervačního IT systému, administrátoři aplikace, online platební brána: Stripe/GoPay, účetní a daňoví poradci).
                    </p>

                    <h3>Doba uchování</h3>
                    <p>
                        Všechny údaje o vaší rezervaci a realizovaných platbách musíme archivovat po dobu 10 let z důvodu účetních a daňových zákonů.
                    </p>

                    <h3>Vaše práva jako subjektu údajů</h3>
                    <p>
                        Máte kdykoliv právo požadovat po správci osobních údajů přístup ke svým osobním údajům, 
                        ejjich opravu nebo výmaz (tam, kde to neomezuje zákon), právo vznést námitku nebo žadost o přenos údajů. 
                        Právo můžete uplatnit písemně na výše zmíněné adrese, anebo e-mailem na <a href="mailto:info@centrumunity.cz" className="text-amber-700 underline">info@centrumunity.cz</a>.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PrivacyPage;
