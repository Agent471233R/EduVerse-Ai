import { GoogleGenAI, Type, GenerateContentResponse, Modality } from '@google/genai';
import { Summary, QuizQuestion } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const videoAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        summary: {
            type: Type.OBJECT,
            properties: {
                brief: { type: Type.STRING, description: "A brief, one-paragraph summary of the video." },
                detailed: { type: Type.STRING, description: "A detailed, multi-paragraph summary of the video." },
                keyPoints: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of key bullet points from the video." },
            },
            required: ["brief", "detailed", "keyPoints"],
        },
        quiz: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    question: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ['multiple-choice', 'true-false', 'short-answer', 'fill-in-the-blank'] },
                    options: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Options for multiple-choice questions." },
                    answer: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                },
                required: ["question", "type", "answer", "explanation"],
            },
        },
    },
    required: ["summary", "quiz"],
};

export const analyzeVideoFrames = async (frames: string[], prompt: string): Promise<{ summary: Summary; quiz: QuizQuestion[] }> => {
    const frameParts = frames.map(frame => ({
        inlineData: { mimeType: 'image/jpeg', data: frame }
    }));

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: [{ parts: [{ text: prompt }, ...frameParts] }],
        config: {
            responseMimeType: 'application/json',
            responseSchema: videoAnalysisSchema,
            thinkingConfig: { thinkingBudget: 32768 },
        },
    });

    const jsonText = response.text.trim();
    return JSON.parse(jsonText);
};

export const analyzeImage = async (base64Image: string, mimeType: string, prompt: string): Promise<string> => {
    const imagePart = { inlineData: { mimeType, data: base64Image } };
    const textPart = { text: prompt };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, textPart] },
    });
    return response.text;
};

export const getQuickAnswer = async (context: string, question: string): Promise<string> => {
    const response = await ai.models.generateContent({
        // FIX: Updated model name from 'gemini-2.5-flash-lite' to 'gemini-flash-lite-latest'.
        model: 'gemini-flash-lite-latest',
        contents: `Based on the following context, answer the user's question.\n\nContext: ${context}\n\nQuestion: ${question}`,
    });
    return response.text;
};


export const getTextToSpeech = async (text: string): Promise<string | undefined> => {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: `Say this: ${text}` }] }],
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Kore' },
                },
            },
        },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
};

export { ai };