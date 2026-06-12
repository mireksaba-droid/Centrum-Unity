import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles, Heart, Users } from 'lucide-react';

const Services = () => {
  return (
    <div className="space-y-16 animate-in fade-in duration-500 pb-12">
      {/* Header */}
      <div className="text-center space-y-4 pt-4 px-4">
        <h1 className="text-4xl font-bold text-stone-900 tracking-tight font-heading">NAŠE SLUŽBY</h1>
        <div className="h-1 w-20 bg-sage-500 mx-auto rounded-full"></div>
      </div>

      {/* Intro Text */}
      <div className="max-w-3xl mx-auto text-center px-4 space-y-6">
        <p className="text-lg text-stone-700 leading-relaxed">
          V Centru Unity nabízíme služby, které propojují péči o tělo, mysl i duši. 
          Masáže, terapie a další přístupy se vzájemně doplňují a podporují. 
          Každá metoda může být cestou k hlubšímu klidu, rovnováze a sebepoznání.
        </p>
        <p className="text-lg text-stone-700 leading-relaxed font-medium">
          Není nutné volit mezi dotekem nebo vnitřní prací – vše je propojené. 
          Vyberte si formu, která s vámi nejvíce rezonuje, a dopřejte si prostor 
          pro regeneraci, uvolnění i vnitřní obnovu.
        </p>
      </div>

      {/* Services List */}
      <div className="space-y-20 px-4">
        
        {/* Masáže */}
        <div className="flex flex-col md:flex-row gap-8 items-center max-w-6xl mx-auto">
          <div className="w-full md:w-1/2 aspect-[4/3] relative rounded-2xl overflow-hidden shadow-lg">
            <img 
              src="https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&q=80&w=1000" 
              alt="Masáže" 
              className="w-full h-full object-cover hover:scale-105 transition-transform duration-700"
            />
            <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full flex items-center gap-2 text-sage-800 font-bold shadow-sm">
                <Sparkles className="w-4 h-4" /> Masáže
            </div>
          </div>
          <div className="w-full md:w-1/2 space-y-6">
            <h2 className="text-3xl font-bold text-stone-900 font-heading">Masáže</h2>
            <div className="space-y-4 text-stone-600 leading-relaxed">
                <p>
                    Masáže v Centru Unity jsou víc než jen péčí o tělo. Jsou dotekem, který přináší uvolnění, harmonii a návrat k sobě. Každá masáž je jiná – může být jemná, energetická, intuitivní nebo hluboce terapeutická.
                </p>
                <p>
                    Vždy však s úctou k vašemu tempu, potřebám a vnitřnímu naladění. Skrze vědomý dotek pomáháme uvolnit fyzické napětí i emoční bloky uložené v těle.
                </p>
            </div>
            <Link to="/" className="inline-flex items-center gap-2 text-sage-700 font-bold hover:text-sage-900 transition-colors group">
                Vybrat maséra <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>

        {/* Terapie */}
        <div className="flex flex-col md:flex-row-reverse gap-8 items-center max-w-6xl mx-auto">
          <div className="w-full md:w-1/2 aspect-[4/3] relative rounded-2xl overflow-hidden shadow-lg">
            <img 
              src="https://images.unsplash.com/photo-1573497620053-ea5300f94f21?auto=format&fit=crop&q=80&w=1000" 
              alt="Terapie" 
              className="w-full h-full object-cover hover:scale-105 transition-transform duration-700"
            />
            <div className="absolute top-4 right-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full flex items-center gap-2 text-sage-800 font-bold shadow-sm">
                <Heart className="w-4 h-4" /> Terapie
            </div>
          </div>
          <div className="w-full md:w-1/2 space-y-6">
            <h2 className="text-3xl font-bold text-stone-900 font-heading">Terapie</h2>
            <div className="space-y-4 text-stone-600 leading-relaxed">
                <p>
                    Terapie v Centru Unity otevírají prostor pro vnitřní porozumění a proměnu. Pomáhají uvolnit emoce, přetvořit staré vzorce a podpořit vědomé prožívání života.
                </p>
                <p>
                    Každý terapeut pracuje svým jedinečným způsobem, ale všechny spojuje společný záměr – doprovodit vás blíž k rovnováze, autenticity a celistvosti. Nabízíme bezpečné prostředí pro vaše sdílení a růst.
                </p>
            </div>
            <Link to="/" className="inline-flex items-center gap-2 text-sage-700 font-bold hover:text-sage-900 transition-colors group">
                Najít terapeuta <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>

        {/* Skupinové akce */}
        <div className="flex flex-col md:flex-row gap-8 items-center max-w-6xl mx-auto">
          <div className="w-full md:w-1/2 aspect-[4/3] relative rounded-2xl overflow-hidden shadow-lg">
            <img 
              src="https://images.unsplash.com/photo-1528319725582-ddc096101511?auto=format&fit=crop&q=80&w=1000" 
              alt="Skupinové akce" 
              className="w-full h-full object-cover hover:scale-105 transition-transform duration-700"
            />
            <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full flex items-center gap-2 text-sage-800 font-bold shadow-sm">
                <Users className="w-4 h-4" /> Skupinové akce
            </div>
          </div>
          <div className="w-full md:w-1/2 space-y-6">
            <h2 className="text-3xl font-bold text-stone-900 font-heading">Skupinové akce</h2>
            <div className="space-y-4 text-stone-600 leading-relaxed">
                <p>
                    Společné prožitky mají sílu, kterou sami v sobě někdy neobjevíme. Ve skupině vzniká prostor pro vzájemnou inspiraci, podporu a hlubší uvědomění. Ať už přicházíte na meditaci, kakaovou ceremonii, ženské setkání, workshop nebo kurz, vždy jde o cestu sdílení, propojení a vnitřního růstu.
                </p>
                <p>
                    V kruhu se učíme naslouchat – sobě i ostatním. Objevujeme nové pohledy, uvolňujeme staré vrstvy a vracíme se blíž ke své podstatě. Síla skupiny pomáhá otevřít to, co by o samotě často zůstalo skryté.
                </p>
            </div>
            <Link to="/" className="inline-flex items-center gap-2 text-sage-700 font-bold hover:text-sage-900 transition-colors group">
                Prohlédnout akce <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Services;