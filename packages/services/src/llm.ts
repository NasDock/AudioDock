import { request } from "./request";

export const extractIntentFromText = async (text: string): Promise<{prompt: string, text: string} | null> => {
  try {
    const response = await request.post<any>("/llm/chat", {
      messages: [
        { role: "user", content: text }
      ]
    });
    // @ts-ignore
    return response?.data || null;
  } catch (error) {
    console.error("Failed to extract intent from text:", error);
    return null;
  }
};
