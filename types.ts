
export interface Summary {
  brief: string;
  detailed: string;
  keyPoints: string[];
}

export interface QuizQuestion {
  question: string;
  type: 'multiple-choice' | 'true-false' | 'short-answer' | 'fill-in-the-blank';
  options?: string[];
  answer: string;
  explanation: string;
}

export interface VideoAnalysisResult {
  summary: Summary;
  quiz: QuizQuestion[];
}

export type AppStatus = 'idle' | 'processing' | 'success' | 'error';
