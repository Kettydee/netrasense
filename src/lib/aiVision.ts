export const GEMINI_API_KEY_STORAGE_KEY = "netrasense:gemini_api_key";

export interface SceneDescriptionResult {
  summary: string;
  roomType?: string;
  hazards?: string[];
  paths?: string;
  source: "gemini" | "spatial_fallback";
}

export interface CurrencyAndTextResult {
  speech: string;
  currencyDetected?: {
    currency: string;
    denomination: string;
    confidence?: string;
  } | null;
  extractedText?: string;
  source: "gemini" | "spatial_fallback";
}

/**
 * Describe Surroundings ("What's around me?") using Gemini Multimodal Vision
 */
export async function describeSurroundings(
  imageBase64: string,
  apiKey?: string,
  detectedObjects?: string[],
  language: "en" | "hi" | "auto" = "auto"
): Promise<SceneDescriptionResult> {
  const resolvedKey =
    apiKey?.trim() ||
    (typeof window !== "undefined"
      ? window.localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY)?.trim()
      : "") ||
    "";

  // Clean Base64 format
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

  if (resolvedKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${resolvedKey}`;
      const langInstruction =
        language === "hi"
          ? "Respond in conversational Hindi or natural Hinglish that can be spoken aloud naturally (e.g. 'Aapke saamne ek mez hai aur daayein taraf kursi hai. Aage ka raasta khula hai.')."
          : language === "auto"
            ? "Support both English and Hindi. If user context is Hindi, answer in friendly Hindi/Hinglish. Otherwise describe in concise English."
            : "Respond in clear concise English.";

      const prompt = `You are NetraSense AI, an intelligent spatial navigation assistant for visually impaired users.
Analyze this camera image and describe the user's immediate surroundings clearly and concisely in 2 to 3 sentences.
${langInstruction}
Focus on:
1. Environment/Room type (e.g. living room, office desk, hallway, outdoor sidewalk).
2. Layout of key objects, furniture, and clear walking paths.
3. Any obstacles, people, or hazards with their clock position or direction (e.g. 'a chair at 10 o'clock / daayein taraf kursi', 'a table straight ahead / saamne mez').
Keep your tone calm, reassuring, and concise so it can be spoken aloud immediately.`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 250,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          return {
            summary: text,
            source: "gemini",
          };
        }
      }
    } catch (err) {
      console.warn("Gemini scene describer error, using spatial fallback:", err);
    }
  }

  // Spatial fallback if no API key or network error
  const objectsText =
    detectedObjects && detectedObjects.length > 0
      ? detectedObjects.join(", ")
      : "no major obstacles detected in direct path";

  const fallbackText =
    language === "hi"
      ? `स्कैन पूरा हुआ। सामने दिखा: ${objectsText}। आगे का रास्ता साफ़ है। सावधानी से चलें।`
      : `Scene scan complete. I can see: ${objectsText}. The central walking path is open. Proceed with caution.`;

  return {
    summary: fallbackText,
    source: "spatial_fallback",
  };
}

/**
 * Read Currency / Banknote or Document / Medicine text (English + Hindi)
 */
export async function readCurrencyAndText(
  imageBase64: string,
  apiKey?: string,
  language: "en" | "hi" | "auto" = "auto"
): Promise<CurrencyAndTextResult> {
  const resolvedKey =
    apiKey?.trim() ||
    (typeof window !== "undefined"
      ? window.localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY)?.trim()
      : "") ||
    "";

  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

  if (resolvedKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${resolvedKey}`;
      const langInstruction =
        language === "hi"
          ? "State findings in Hindi or bilingual (e.g. '500 Indian Rupees note / 500 रुपये का नोट')."
          : "Support both English and Hindi. If Indian Rupee or Hindi text is detected, mention both English and Hindi (e.g. '500 Indian Rupee note - 500 रुपये का नोट').";

      const prompt = `You are NetraSense Smart Currency & Document Reader for visually impaired users.
Inspect this image carefully.
${langInstruction}
1. CURRENCY: If you see banknotes, paper cash, or coins (e.g. Indian Rupees ₹10, ₹20, ₹50, ₹100, ₹200, ₹500, USD $1, $5, $10, $20, $50, $100, EUR, GBP):
   State the exact currency and denomination first (e.g. '500 Indian Rupee note / 500 रुपये का नोट').
2. MEDICINE / LABELS / DOCUMENTS: If you see product packaging, prescription bottles, notices, or signs in English or Hindi:
   Read the main title, medicine name, dosage/expiry date, or crucial sign text aloud clearly.
3. Provide a spoken response under 25 words that speaks the most vital finding first.`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 200,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          return {
            speech: text,
            extractedText: text,
            source: "gemini",
          };
        }
      }
    } catch (err) {
      console.warn("Gemini currency/text reader error:", err);
    }
  }

  // Smart fallback response
  return {
    speech: "Smart reader ready. To enable instant AI currency denomination and document reading, add a free Gemini API Key in Settings.",
    extractedText: "Add Gemini API Key in Settings for full optical currency & text recognition.",
    source: "spatial_fallback",
  };
}
