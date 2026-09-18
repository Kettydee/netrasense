export const GEMINI_API_KEY_STORAGE_KEY = "netrasense:gemini_api_key";
export const ENROLLED_FACES_STORAGE_KEY = "netrasense:enrolled_face_profiles";
export const FAMILIAR_CONTACTS_KEY = "netrasense:familiar_faces";

/** Resolve the backend server URL for local Python vision / proxy service. */
function getServerUrl(): string {
  if (typeof window === "undefined") return "http://localhost:5000";
  const stored = window.localStorage.getItem("netrasense:sensorServerUrl")?.trim();
  if (stored) return stored.replace(/\/$/, "");
  return "http://localhost:5000";
}

/**
 * Resolve the Gemini API key from explicit arg, localStorage, or Vite build-time env var.
 */
export function getResolvedGeminiApiKey(explicitKey?: string): string {
  const direct = explicitKey?.trim();
  if (direct) return direct;
  if (typeof window !== "undefined") {
    const fromStorage = window.localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY)?.trim();
    if (fromStorage) return fromStorage;
  }
  const fromEnv = (import.meta as any).env?.VITE_GEMINI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return "";
}

/**
 * Universal Gemini API caller:
 * 1. Prioritizes direct Google Generative Language API if an API key exists in Settings / localStorage / Env.
 *    (This works anywhere in the world on https://netrasense.vercel.app with zero backend requirement).
 * 2. If no client-side key or if direct call fails, tries the local vision server proxy.
 */
export async function callGemini(
  contents: unknown[],
  generationConfig: unknown = { temperature: 0.1, maxOutputTokens: 300 },
  apiKey?: string,
): Promise<any> {
  const resolvedKey = getResolvedGeminiApiKey(apiKey);

  if (resolvedKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${resolvedKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": resolvedKey,
        },
        body: JSON.stringify({ contents, generationConfig }),
      });

      if (res.ok) {
        return await res.json();
      }
      const errText = await res.text().catch(() => "");
      console.warn(`Direct Gemini API failed (${res.status}):`, errText);
    } catch (directErr) {
      console.warn("Direct Gemini fetch error, trying local proxy fallback:", directErr);
    }
  }

  // Fallback: try local server proxy if running
  try {
    const res = await fetch(`${getServerUrl()}/api/gemini-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, generationConfig }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // proxy unavailable
  }

  throw new Error("No active Gemini API Key found. Please add your free Gemini API Key in Settings.");
}

/** Check if any Gemini API key is available (client-side or local server). */
export async function hasGeminiKey(apiKey?: string): Promise<boolean> {
  if (getResolvedGeminiApiKey(apiKey)) return true;
  try {
    const res = await fetch(`${getServerUrl()}/api/gemini-config`);
    if (res.ok) {
      const data = (await res.json()) as { has_key: boolean };
      return Boolean(data.has_key);
    }
  } catch {}
  return false;
}

export async function setGeminiApiKeyOnServer(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${getServerUrl()}/api/gemini-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (res.ok) {
      const data = (await res.json()) as { has_key: boolean };
      return data.has_key;
    }
  } catch {}
  return false;
}

export async function hasGeminiApiKeyOnServer(): Promise<boolean> {
  return hasGeminiKey();
}

// ── Biometric Face Profile Management ────────────────────────────────

export interface EnrolledFaceProfile {
  id: string;
  name: string;
  imageBase64: string; // Compact JPEG data URL of reference face
  enrolledAt: string;
}

/** Get all enrolled face profiles with reference images from localStorage. */
export function getStoredFaceProfiles(): EnrolledFaceProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(ENROLLED_FACES_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

/** Save an enrolled face profile with reference image into localStorage. */
export function saveStoredFaceProfile(profile: EnrolledFaceProfile): void {
  if (typeof window === "undefined") return;
  const current = getStoredFaceProfiles();
  const filtered = current.filter((p) => p.name.toLowerCase() !== profile.name.toLowerCase());
  filtered.push(profile);
  window.localStorage.setItem(ENROLLED_FACES_STORAGE_KEY, JSON.stringify(filtered));

  // Sync names into familiar contacts list
  const names = filtered.map((p) => p.name);
  window.localStorage.setItem(FAMILIAR_CONTACTS_KEY, JSON.stringify(names));
}

/** Delete an enrolled face profile by name. */
export function deleteStoredFaceProfile(name: string): void {
  if (typeof window === "undefined") return;
  const current = getStoredFaceProfiles();
  const filtered = current.filter((p) => p.name.toLowerCase() !== name.toLowerCase());
  window.localStorage.setItem(ENROLLED_FACES_STORAGE_KEY, JSON.stringify(filtered));

  const names = filtered.map((p) => p.name);
  window.localStorage.setItem(FAMILIAR_CONTACTS_KEY, JSON.stringify(names));
}

/** Compress / resize a camera frame to ~280px max for compact biometric storage. */
export function compressFaceImage(base64DataUrl: string, maxDim: number = 280): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(base64DataUrl);
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      } else {
        resolve(base64DataUrl);
      }
    };
    img.onerror = () => resolve(base64DataUrl);
    img.src = base64DataUrl;
  });
}

// ── Local Python ArcFace Server Bridge (Optional Local Accelerator) ─

export async function enrollFaceBiometric(
  name: string,
  imageBase64: string,
  serverUrl: string = "http://localhost:5000",
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${serverUrl}/api/face/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, frame: imageBase64 }),
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: `Could not reach local server at ${serverUrl}.`,
    };
  }
}

export async function fetchEnrolledFaces(
  serverUrl: string = "http://localhost:5000",
): Promise<Array<{ name: string; enrolled_at: string; samples_count: number }>> {
  try {
    const res = await fetch(`${serverUrl}/api/face/list`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      return data.faces || [];
    }
  } catch {}
  return [];
}

export async function deleteEnrolledFace(
  name: string,
  serverUrl: string = "http://localhost:5000",
): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl}/api/face/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch {
    return false;
  }
}

// ── Smart Scene, Currency, and Face Identification ───────────────────

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

export interface FaceMoodResult {
  speech: string;
  peopleCount: number;
  identifiedName?: string;
  confidence?: number;
  distanceScore?: number;
  mood: string;
  moodEmoji: string;
  distanceEstimate: string;
  actionDescription: string;
  source: "arcface_deepface" | "gemini" | "spatial_fallback";
}

/**
 * Describe Surroundings ("What's around me?") using Gemini Multimodal Vision
 */
export async function describeSurroundings(
  imageBase64: string,
  apiKey?: string,
  detectedObjects?: string[],
  language: "en" | "hi" | "auto" = "auto",
): Promise<SceneDescriptionResult> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

  try {
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
3. Any obstacles, people, or hazards with their clock position or direction (e.g. 'a chair at 10 o'clock', 'a table straight ahead').
Keep your tone calm, reassuring, and concise so it can be spoken aloud immediately.`;

    const response = await callGemini(
      [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64Data } }] }],
      { temperature: 0.2, maxOutputTokens: 250, thinkingConfig: { thinkingBudget: 0 } },
      apiKey,
    );

    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text) {
      return { summary: text, source: "gemini" };
    }
  } catch (err) {
    console.warn("Gemini scene describer error:", err);
  }

  const objectsText =
    detectedObjects && detectedObjects.length > 0
      ? detectedObjects.join(", ")
      : "no major obstacles detected in direct path";

  const fallbackText =
    language === "hi"
      ? `स्कैन पूरा हुआ। सामने दिखा: ${objectsText}। आगे का रास्ता साफ़ है।`
      : `Scene scan complete. I can see: ${objectsText}. The central walking path is open. Proceed with caution.`;

  return { summary: fallbackText, source: "spatial_fallback" };
}

/**
 * Read Currency / Banknote or Document / Medicine text (English + Hindi)
 */
export async function readCurrencyAndText(
  imageBase64: string,
  apiKey?: string,
  language: "en" | "hi" | "auto" = "auto",
): Promise<CurrencyAndTextResult> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

  try {
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

    const response = await callGemini(
      [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64Data } }] }],
      { temperature: 0.1, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
      apiKey,
    );

    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text) {
      return { speech: text, extractedText: text, source: "gemini" };
    }
  } catch (err) {
    console.warn("Gemini currency/text reader error:", err);
  }

  const hasKey = Boolean(getResolvedGeminiApiKey(apiKey));
  return {
    speech: hasKey
      ? "Currency scan completed. Could not recognize currency note clearly. Please hold the banknote flat in front of the lens."
      : "Smart reader ready. To enable instant AI currency denomination and document reading, add a free Gemini API Key in Settings.",
    extractedText: hasKey
      ? "Note not clearly recognized - ensure good lighting."
      : "Add Gemini API Key in Settings for full optical currency & text recognition.",
    source: "spatial_fallback",
  };
}

/**
 * Identify Familiar Faces & Mood / Expression ("Who is in front of me?")
 * Uses local ArcFace engine if running, otherwise uses visual one-shot multimodal comparison with enrolled face images.
 */
export async function identifyFaceAndMood(
  imageBase64: string,
  familiarContacts: string[] = [],
  apiKey?: string,
  language: "en" | "hi" | "auto" = "auto",
): Promise<FaceMoodResult> {
  // 1. Prioritize ArcFace Biometric Vision Server if reachable on localhost
  try {
    const localResp = await fetch("http://localhost:5000/api/face/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame: imageBase64 }),
    });

    if (localResp.ok) {
      const data = await localResp.json();
      if (data.success) {
        return {
          speech: data.speech || "Person detected.",
          peopleCount: data.peopleCount ?? 1,
          identifiedName: data.identifiedName || undefined,
          confidence: data.confidence,
          distanceScore: data.distanceScore,
          mood: data.mood || "Attentive",
          moodEmoji: data.moodEmoji || "👤",
          distanceEstimate: data.distanceEstimate || "1 to 2 meters ahead",
          actionDescription: data.actionDescription || "In front of camera",
          source: "arcface_deepface",
        };
      }
    }
  } catch {
    // Local vision server offline; proceed to visual Multimodal Gemini Face Recognition
  }

  // 2. Multimodal Visual Biometric Comparison using Gemini
  const liveBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const storedProfiles = getStoredFaceProfiles();

  try {
    const parts: any[] = [];

    if (storedProfiles.length > 0) {
      const promptText = `You are NetraSense AI, an intelligent biometric face and emotion identifier for a visually impaired user.
The user is looking through their camera.
Below are the enrolled reference face photos of known contacts:
${storedProfiles.map((p, i) => `${i + 1}. "${p.name}"`).join("\n")}

BIOMETRIC RECOGNITION RULES:
1. Carefully compare the human face in the LIVE CAMERA IMAGE against each of the enrolled reference photos.
2. Compare facial features, bone structure, eye shape, nose shape, and mouth.
3. If the person in the LIVE CAMERA IMAGE is clearly the same person as one of the enrolled reference photos, set "identifiedName" to that person's exact name and set "confidence" to an integer between 85 and 99.
4. If the person does NOT match any enrolled reference photo, set "identifiedName" to null and "confidence" to 0.
5. If no human face is visible in the live camera image, set "peopleCount" to 0.
6. Identify their facial expression/mood (e.g. "Smiling warmly", "Attentive and calm", "Surprised", "Looking concerned") and provide a matching emoji.
7. Estimate their distance (e.g. "1.2 meters ahead").
8. Generate a reassuring speech readout under 25 words:
   - If recognized: "[Name] is [distance] ahead, [expression]."
   - If unfamiliar: "An unfamiliar person is [distance] ahead, looking [expression]."
   - If no face: "No person detected in front of the camera."

Respond ONLY with this JSON object (no markdown, no backticks):
{
  "peopleCount": 1,
  "identifiedName": "Name" or null,
  "confidence": 92,
  "mood": "Smiling warmly",
  "moodEmoji": "😊",
  "distanceEstimate": "1.2 meters ahead",
  "actionDescription": "In front of camera",
  "speech": "Name is 1.2 meters ahead, smiling warmly at you."
}`;

      parts.push({ text: promptText });

      // Add each enrolled reference face photo
      storedProfiles.forEach((p) => {
        const cleanRef = p.imageBase64.replace(/^data:image\/\w+;base64,/, "");
        parts.push({ text: `Enrolled Reference Photo for "${p.name}":` });
        parts.push({ inlineData: { mimeType: "image/jpeg", data: cleanRef } });
      });

      // Add the live camera frame to identify
      parts.push({ text: "LIVE CAMERA IMAGE TO IDENTIFY:" });
      parts.push({ inlineData: { mimeType: "image/jpeg", data: liveBase64 } });
    } else {
      // No enrolled photos yet, just detect face presence and mood
      const promptText = `You are NetraSense AI, an intelligent face and emotion identifier for a visually impaired user.
Analyze the person in this camera image.
Determine if a person is in front of the camera, read their facial expression/mood, and estimate their distance.
Respond ONLY with this JSON object (no markdown, no backticks):
{
  "peopleCount": 1,
  "identifiedName": null,
  "confidence": 0,
  "mood": "Attentive and calm",
  "moodEmoji": "🙂",
  "distanceEstimate": "1.5 meters ahead",
  "actionDescription": "In front of camera",
  "speech": "An unfamiliar person is 1.5 meters ahead, looking attentive."
}`;
      parts.push({ text: promptText });
      parts.push({ inlineData: { mimeType: "image/jpeg", data: liveBase64 } });
    }

    const response = await callGemini(
      [{ parts }],
      { temperature: 0.1, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } },
      apiKey,
    );

    const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    const cleanJson = rawText.replace(/^```(json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleanJson);

    return {
      speech: parsed.speech || "A person is in front of you.",
      peopleCount: parsed.peopleCount ?? 1,
      identifiedName: parsed.identifiedName || undefined,
      confidence: parsed.confidence,
      mood: parsed.mood || "Attentive",
      moodEmoji: parsed.moodEmoji || "👤",
      distanceEstimate: parsed.distanceEstimate || "1 to 2 meters ahead",
      actionDescription: parsed.actionDescription || "In front of camera",
      source: "gemini",
    };
  } catch (err) {
    console.error("Gemini face/mood identifier failed:", err);
  }

  const hasKey = Boolean(getResolvedGeminiApiKey(apiKey));
  return {
    speech: hasKey
      ? "Face scan complete. Could not identify face clearly. Please face the camera directly in good lighting."
      : "To recognize faces and read expressions on the live web, please add your free Gemini API Key in Settings.",
    peopleCount: 1,
    mood: hasKey ? "Uncertain" : "Setup Needed",
    moodEmoji: "👤",
    distanceEstimate: "1.5 meters",
    actionDescription: "In view",
    source: "spatial_fallback",
  };
}

export interface IndoorNavResult {
  instruction: string;
  isArrived: boolean;
  clearanceStatus: "Safe" | "Caution" | "Blocked";
  obstaclesInPath?: string[];
  keyLandmarks?: string[];
  source: "gemini" | "spatial_fallback";
}

/**
 * Step-by-Step Indoor Landmark Navigator
 */
export async function navigateIndoorPath(
  imageBase64: string,
  destination: string,
  currentStep: number = 1,
  apiKey?: string,
): Promise<IndoorNavResult> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

  try {
    const prompt = `You are NetraSense AI, an indoor assistive waypoint navigator for a visually impaired user.
The user wants to reach: "${destination}".
Current navigation step: ${currentStep}.

Analyze this camera image. Look for doorways, clear corridors, stairs, walls, furniture, and landmarks.
Provide the next immediate physical instruction to navigate safely towards "${destination}".

Return strictly valid JSON with these keys:
{
  "instruction": "Walk forward 5 steps, then turn right towards the open doorway.",
  "isArrived": false,
  "clearanceStatus": "Safe" (or "Caution", "Blocked"),
  "obstaclesInPath": ["chair on left", "open door ahead"],
  "keyLandmarks": ["doorway", "hallway table"]
}

Rules:
- Keep "instruction" under 20 words, unambiguous, directional (left/right/forward/stop).
- Set isArrived to true ONLY if the target destination is clearly reached right in front of the camera.
- Respond ONLY with the JSON object, without markdown formatting.`;

    const response = await callGemini(
      [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64Data } }] }],
      { temperature: 0.1, maxOutputTokens: 250, thinkingConfig: { thinkingBudget: 0 } },
      apiKey,
    );

    const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    const cleanJson = rawText.replace(/^```(json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleanJson);

    return {
      instruction: parsed.instruction || `Step ${currentStep}: Move forward carefully towards ${destination}.`,
      isArrived: Boolean(parsed.isArrived),
      clearanceStatus: parsed.clearanceStatus || "Safe",
      obstaclesInPath: parsed.obstaclesInPath || [],
      keyLandmarks: parsed.keyLandmarks || [],
      source: "gemini",
    };
  } catch (err) {
    console.error("Gemini indoor navigator failed:", err);
  }

  return {
    instruction: `Step ${currentStep}: Move forward carefully. Scanning for ${destination}...`,
    isArrived: false,
    clearanceStatus: "Safe",
    source: "spatial_fallback",
  };
}
