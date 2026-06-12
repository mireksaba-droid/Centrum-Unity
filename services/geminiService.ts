import { GoogleGenAI } from "@google/genai";

// Bezpečné načtení klíče, které nespadne, pokud process není definován
const getApiKey = () => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env) {
      // @ts-ignore
      return process.env.API_KEY || '';
    }
    // @ts-ignore
    if (typeof window !== 'undefined' && window.process && window.process.env) {
      // @ts-ignore
      return window.process.env.API_KEY || '';
    }
    return '';
  } catch (e) {
    return '';
  }
};

const API_KEY = getApiKey();

export const getWellnessAdvice = async (userQuery: string): Promise<string> => {
  if (!API_KEY) {
    // Tichý fallback, aby aplikace neřvala chyby do konzole, pokud klíč chybí
    return "Omlouvám se, ale AI asistent není momentálně dostupný (chybí konfigurace).";
  }

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: userQuery,
      config: {
        systemInstruction: `Jsi empatický wellness asistent pro platformu "Centrum Unity". 
        Tvá role je pomoci uživatelům najít rovnováhu a doporučit vhodné typy praktiků (terapeuty, kouče, jogíny).
        Odpovídej stručně, česky, povzbudivě a profesionálně. 
        Pokud se uživatel ptá na vážné zdravotní problémy, vždy doporuč návštěvu lékaře.`,
        thinkingConfig: { thinkingBudget: 0 } 
      }
    });

    return response.text || "Omlouvám se, ale momentálně nemohu odpovědět. Zkuste to prosím později.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Došlo k chybě při komunikaci s AI asistentem.";
  }
};