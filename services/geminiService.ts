import { GoogleGenAI, Type } from "@google/genai";
import { PlannerCategory, Task } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateStudyPlan = async (
  topic: string,
  category: PlannerCategory,
  days: number = 1
): Promise<Partial<Task>[]> => {
  const prompt = `
    Create a detailed ${category.toLowerCase()} schedule for the topic "${topic}" covering ${days} days.
    Break it down into actionable tasks.
    Return a JSON array where each object has a 'title' (string), 'durationMinutes' (integer, usually 30-90), and 'subject' (string).
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              durationMinutes: { type: Type.INTEGER },
              subject: { type: Type.STRING },
            },
            required: ["title", "durationMinutes", "subject"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    
    const parsed = JSON.parse(text);
    return parsed.map((item: any) => ({
      ...item,
      category,
      completed: false,
      // Date assignment is handled by the caller to spread these over the requested days
    }));

  } catch (error) {
    console.error("Gemini API Error:", error);
    return [];
  }
};

export const getMotivation = async (): Promise<string> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: "Give me a short, punchy, 1-sentence motivation quote for a student studying hard.",
        });
        return response.text || "Stay focused!";
    } catch (e) {
        return "Stay focused!";
    }
}