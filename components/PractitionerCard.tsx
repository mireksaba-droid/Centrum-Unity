import React from 'react';
import { Practitioner } from '../types';
import { Star } from 'lucide-react';
import Button from './Button';

interface PractitionerCardProps {
  practitioner: Practitioner;
  onBook: (practitioner: Practitioner) => void;
}

const PractitionerCard: React.FC<PractitionerCardProps> = ({ practitioner, onBook }) => {
  // Calculate price range safely
  const prices = practitioner.services.map(s => s.price);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  
  return (
    <div className="bg-white rounded-xl shadow-sm border border-stone-100 overflow-hidden hover:shadow-md transition-shadow flex flex-col h-full">
      <div className="relative h-48 overflow-hidden">
        <img 
          src={practitioner.imageUrl} 
          alt={practitioner.name} 
          className="w-full h-full object-cover transition-transform hover:scale-105 duration-500"
        />
        <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full text-xs font-semibold text-sage-800 uppercase tracking-wide">
          {practitioner.category}
        </div>
      </div>
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h3 className="text-lg font-bold text-stone-900 font-heading">{practitioner.name}</h3>
            <p className="text-sm text-stone-500">{practitioner.title}</p>
          </div>
          {practitioner.rating > 0 && (
            <div className="flex items-center space-x-1 bg-yellow-50 px-2 py-1 rounded-md">
                <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                <span className="text-sm font-bold text-stone-800">{practitioner.rating}</span>
            </div>
          )}
        </div>

        <p className="text-stone-600 text-sm line-clamp-2 mb-4">
          {practitioner.description}
        </p>

        <div className="flex flex-wrap gap-2 mb-4 mt-auto">
          {practitioner.specialties.map(spec => (
            <span key={spec} className="px-2 py-1 bg-stone-100 text-stone-600 text-xs rounded-md">
              {spec}
            </span>
          ))}
        </div>

        <div className="border-t border-stone-100 pt-4 flex items-center justify-between mt-4">
          <div className="text-stone-900 font-bold">
            {prices.length > 0 ? `od ${minPrice} Kč` : 'Cena neuvedena'}
          </div>
          <Button onClick={() => onBook(practitioner)} size="sm">
            Rezervovat
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PractitionerCard;