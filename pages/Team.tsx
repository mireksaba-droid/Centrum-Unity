import React from 'react';
import { Practitioner } from '../types';
import PractitionerCard from '../components/PractitionerCard';
import { useStore } from '../store/useStore';

const Team = ({ onBook }: { onBook: (p: Practitioner) => void }) => {
    const { practitionersList } = useStore();
    return (
        <div className="space-y-12 animate-in fade-in duration-500 pb-12">
            {/* Header */}
            <div className="text-center space-y-4 pt-4">
                <h1 className="text-4xl font-bold text-stone-900 tracking-tight font-heading">NÁŠ TÝM</h1>
                <div className="h-1 w-20 bg-sage-500 mx-auto rounded-full"></div>
            </div>

            {/* Description Text */}
            <div className="max-w-3xl mx-auto text-center space-y-6 px-4">
                <h3 className="text-xl font-medium text-sage-700 italic font-serif">Různorodí v přístupu, spojení v záměru</h3>
                <div className="space-y-6 text-lg text-stone-700 leading-relaxed">
                    <p>
                        Tým Centra Unity tvoří lidé s rozmanitými zkušenostmi, dovednostmi a přístupy. Každý z nás kráčí svou jedinečnou cestou, pracuje s jinými metodami a nástroji – a právě tato pestrost je naší silou.
                    </p>
                    <p>
                        Co nás však spojuje, je společný záměr: podporovat probuzení, autenticitu a návrat k celistvosti. Ať už skrze práci s tělem, energií, myslí nebo duší, všichni vycházíme ze stejných principů – respekt, vědomá přítomnost, laskavost a hluboké napojení na vnitřní pravdu.
                    </p>
                    <p>
                        Věříme, že každé setkání má smysl. A jsme tady proto, abychom vás na vaší cestě podpořili – právě tím způsobem, který s vámi bude nejvíce souznít.
                    </p>
                </div>
            </div>

            {/* Practitioner Grid */}
            <div className="px-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {practitionersList.filter(p => p.isActive).map(practitioner => (
                        <PractitionerCard 
                            key={practitioner.id} 
                            practitioner={practitioner} 
                            onBook={onBook} 
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Team;