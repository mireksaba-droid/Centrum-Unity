import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';

const CAROUSEL_IMAGES = [
  'https://images.unsplash.com/photo-1545205597-3d9d02c29597?auto=format&fit=crop&q=80&w=1200', // Yoga/Wellness
  'https://images.unsplash.com/photo-1518241353330-0f7941c2d9b5?auto=format&fit=crop&q=80&w=1200', // Nature/Relax
  'https://images.unsplash.com/photo-1529693096015-8d43236eb485?auto=format&fit=crop&q=80&w=1200', // Incense/Mood
  'https://images.unsplash.com/photo-1593811167562-9cef47bfc4d7?auto=format&fit=crop&q=80&w=1200', // Massage
  'https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&q=80&w=1200'  // Meditation
];

const About = () => {
    // Carousel State
    const [currentSlide, setCurrentSlide] = useState(0);

    const nextSlide = () => {
        setCurrentSlide((prev) => (prev + 1) % CAROUSEL_IMAGES.length);
    };

    const prevSlide = () => {
        setCurrentSlide((prev) => (prev - 1 + CAROUSEL_IMAGES.length) % CAROUSEL_IMAGES.length);
    };

    return (
        <div className="space-y-20 animate-in fade-in duration-500 pb-12">
            {/* Header */}
            <div className="text-center space-y-4 pt-4">
                <h1 className="text-4xl font-bold text-stone-900 tracking-tight font-heading">O NÁS</h1>
                <div className="h-1 w-20 bg-sage-500 mx-auto rounded-full"></div>
            </div>

            {/* Video Section */}
            <div className="max-w-4xl mx-auto px-4">
                <div className="relative w-full aspect-video bg-stone-900 rounded-2xl overflow-hidden shadow-xl group cursor-pointer">
                    <img 
                        src="https://images.unsplash.com/photo-1600618528240-fb9fc964b853?auto=format&fit=crop&q=80&w=2000" 
                        alt="Centrum Unity Video Thumbnail" 
                        className="w-full h-full object-cover opacity-60 group-hover:opacity-40 transition-opacity duration-300"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-white/20 backdrop-blur-md p-6 rounded-full group-hover:scale-110 transition-transform duration-300">
                            <Play className="w-12 h-12 text-white fill-white pl-1" />
                        </div>
                    </div>
                    <div className="absolute bottom-4 left-4 text-white font-medium bg-black/30 px-3 py-1 rounded-full backdrop-blur-sm">
                        Představení Centra Unity
                    </div>
                </div>
            </div>

            {/* Philosophy Text */}
            <div className="max-w-3xl mx-auto space-y-8 text-lg text-stone-700 leading-relaxed text-center px-4">
                <h2 className="text-3xl font-bold text-sage-800 font-heading">Filozofie Centra Unity</h2>
                <div className="space-y-6">
                    <p>
                        Centrum Unity je prostorem pro návrat k sobě samým – k vnitřnímu klidu, celistvosti a hlubšímu propojení se svou podstatou. Je to místo, kde se setkávají lidé, cesty i metody. Věříme, že každý člověk má svou jedinečnou cestu osobního a duchovního růstu – a každý po ní kráčí svým vlastním způsobem.
                    </p>
                    <p>
                        Z této víry vychází i samotná myšlenka Centra Unity: propojovat a spojovat. Terapeuty, maséry, kouče, průvodkyně, mentory i lektory – každého, kdo svým přístupem podporuje celistvost, sebepoznání a léčení. Protože to, co pomáhá jednomu, nemusí oslovit druhého. A právě v této rozmanitosti vidíme sílu.
                    </p>
                    <p>
                        Usilujeme o co nejvíce celistvý přístup skrze různorodost. Ať už se jedná o rozdílné metody, nebo o individuální styl práce jednotlivých průvodců – každé setkání je unikátní. I stejná technika může mít jiný účinek v rukou různých lidí, protože každý do své práce vnáší svůj jedinečný otisk, svoji esenci.
                    </p>
                </div>
            </div>

            {/* Photo Carousel */}
            <div className="space-y-8 px-4">
                 <h2 className="text-3xl font-bold text-stone-900 text-center font-heading">Prostory Centra</h2>
                 <div className="relative group max-w-5xl mx-auto rounded-2xl overflow-hidden shadow-2xl aspect-[16/9] bg-stone-100">
                    <img 
                        src={CAROUSEL_IMAGES[currentSlide]} 
                        alt={`Slide ${currentSlide + 1}`} 
                        className="w-full h-full object-cover transition-transform duration-700 hover:scale-105"
                    />
                    
                    {/* Overlay Gradient */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>

                    {/* Controls */}
                    <button 
                        onClick={prevSlide}
                        className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white p-3 rounded-full shadow-lg text-stone-800 transition-all opacity-0 group-hover:opacity-100 transform -translate-x-2 group-hover:translate-x-0"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button 
                        onClick={nextSlide}
                        className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white p-3 rounded-full shadow-lg text-stone-800 transition-all opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0"
                    >
                        <ChevronRight className="w-6 h-6" />
                    </button>

                    {/* Indicators */}
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex space-x-2">
                        {CAROUSEL_IMAGES.map((_, idx) => (
                            <button
                                key={idx}
                                onClick={() => setCurrentSlide(idx)}
                                className={`h-2 rounded-full transition-all duration-300 ${
                                    idx === currentSlide ? 'bg-white w-8' : 'bg-white/50 w-2 hover:bg-white/80'
                                }`}
                            />
                        ))}
                    </div>
                 </div>
            </div>
        </div>
    );
};

export default About;