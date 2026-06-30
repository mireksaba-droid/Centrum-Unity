export const getWellnessAdvice = async (userQuery: string): Promise<string> => {
  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userQuery }] }],
        systemInstruction: {
          role: "system",
          parts: [{ text: `Jsi empatický wellness asistent pro platformu "Centrum Unity". 
        Tvá role je pomoci uživatelům najít rovnováhu a doporučit vhodné typy praktiků (terapeuty, kouče, jogíny).
        Odpovídej stručně, česky, povzbudivě a profesionálně. 
        Pokud se uživatel ptá na vážné zdravotní problémy, vždy doporuč návštěvu lékaře.` }]
        }
      })
    });
    
    if (!response.ok) {
        throw new Error('Network response was not ok');
    }
    
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Omlouvám se, ale momentálně nemohu odpovědět. Zkuste to prosím později.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Došlo k chybě při komunikaci s AI asistentem.";
  }
};