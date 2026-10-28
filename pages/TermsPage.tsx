import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const TermsPage: React.FC = () => {
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
                    <h1 className="text-3xl font-heading font-bold text-stone-900">Obchodní podmínky</h1>
                    <p className="text-stone-500 mt-2">včetně Reklamačního řádu a informací o odstoupení od smlouvy</p>
                </div>

                <div className="prose prose-stone max-w-none text-sm leading-relaxed">
                    <h3>1. Základní ustanovení</h3>
                    <p>
                        Tyto obchodní podmínky upravují vzájemná práva a povinnosti mezi prodávajícím/poskytovatelem 
                        <strong>Eva Kadlecová - Centrum Unity</strong>, IČO: 73750565, se sídlem Šmilovského 10, Vinohrady, Praha 2 
                        a kupujícím.
                    </p>

                    <h3>2. Nabízené služby a jejich specifikace</h3>
                    <p>
                        Předmětem prodeje je jednorázový nebo opakovaný pronájem vyhrazených prostor 
                        (místností) v rámci sdíleného coworkingu / studia. Popis jednotlivých prostor (vybavení, kapacita) 
                        je uveden v rezervačním systému u příslušné služby.
                    </p>

                    <h3>3. Cena a platba</h3>
                    <p>
                        Uvedené ceny v rezervačním systému jsou konečné a zahrnují všechny poplatky (vč. DPH dle platné sazby).<br/>
                        Platba za pronájem probíhá prostřednictvím online platební brány (GoPay / Stripe), nebo dodatečně na základě vystavené faktury 
                        (záleží na formě spolupráce).
                    </p>

                    <h3>4. Zrušení rezervace, storno podmínky a možnost přesunu</h3>
                    <p>
                        Dle občanského zákoníku se na smlouvy o poskytnutí služeb volného času a pronájmu v přesně stanoveném 
                        termínu <strong>nevztahuje zákonná lhůta pro odstoupení do 14 dnů bez udání důvodu</strong>. 
                        V Centru Unity platí následující storno pravidla a garance pro lektory i klienty:
                    </p>
                    <ul className="list-disc pl-5 space-y-1.5">
                        <li><strong>Více než 7 dní před začátkem rezervace:</strong> vrácení 100 % zaplacené částky (storno poplatek 0 %).</li>
                        <li><strong>7 dní až 24 hodin před začátkem rezervace:</strong> storno poplatek 50 % z ceny rezervace (vrácení 50 % zaplacené částky zpět na platební kartu).</li>
                        <li><strong>Méně než 24 hodin před začátkem rezervace:</strong> storno poplatek 100 % z ceny rezervace (zaplacená částka se nevrací).</li>
                    </ul>
                    <div className="mt-4 p-3.5 bg-amber-50/80 border border-amber-200/80 rounded-xl text-stone-700">
                        <strong>Garance 1× bezplatného přesunu termínu:</strong><br/>
                        U každé rezervace je nově umožněn jeden přesun na jiný volný termín v rezervačním systému. Pokud vám například onemocní klient, můžete ho přeobjednat a rezervace vám nepropadne. Každou rezervaci lze bezplatně přesunout pouze 1×.
                    </div>

                    <h3>5. Dodání služby (Plnění)</h3>
                    <p>
                        Služba pronájmu je poskytnuta ve sjednaném čase v prostorách studia Centrum Unity na adrese Šmilovského 10, Praha 2. 
                        Kupující obdrží potvrzení s instrukcemi ohledně vstupu na e-mail po dokončení platby. Náklady na dodání jsou 0 Kč, 
                        nejedná se o fyzické zboží.
                    </p>

                    <h3>6. Reklamační řád</h3>
                    <p>
                        V případě, že rezervovaný prostor není ve stavu, který odpovídá popisu nebo předchozí domluvě, 
                        má kupující právo službu reklamovat.<br/>
                        <strong>Jak reklamaci ohlásit:</strong> emailem na <a href="mailto:info@centrumunity.cz" className="text-amber-700 underline">info@centrumunity.cz</a>, případně 
                        osobně u manažera studia.<br/>
                        <strong>Potřebné náležitosti:</strong> uveďte číslo rezervace, datum a konkrétní vady plnění.<br/>
                        Reklamace bude vyřízena bezodkladně, nejpozději však do 30 dnů od jejího uplatnění. O průběhu a výsledku zhodnocení reklamace bude klient informován e-mailem. 
                        V případě oprávněné reklamace má kupující nárok na slevu z pronájmu, nebo vrácení plné částky (při nemožnosti prostor užívat).
                    </p>

                    <h3>7. Závěrečná ustanovení</h3>
                    <p>
                        Tyto podmínky nabývají platnosti a účinnosti dnem 1. ledna 2026.<br/>
                        Provozovatel si vyhrazuje právo obchodní podmínky měnit a doplňovat.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default TermsPage;
