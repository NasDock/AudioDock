import { request } from "./request";

const TTS_BASE_URL = "/tts";

export interface TtsVoice {
  label: string;
  value: string;
}

export interface TtsFileItem {
  filename: string;
  full_path: string;
  is_generated: boolean;
}

export interface TtsReviewItem {
  key: string;
  filename: string;
  full_path: string;
  title: string;
  author: string;
  voice: string;
  temp_path?: string;
  file_id?: string;
}

export interface TtsTask {
  id: string;
  book_name: string;
  author: string;
  status: "pending" | "processing" | "completed" | "paused" | "failed";
  total_chapters: number;
  completed_chapters: number;
  created_at: string;
}

export const getTtsVoices = (): Promise<TtsVoice[]> => {
  return request.get(`${TTS_BASE_URL}/api/tasks/voices`);
};

export const getTtsLocalFiles = (): Promise<{ success: boolean; files: TtsFileItem[] }> => {
  return request.get(`${TTS_BASE_URL}/api/tasks/list-files`);
};

export const uploadTtsFile = (file: any): Promise<{
  success: boolean;
  filename: string;
  temp_path: string;
  title?: string;
  author?: string;
  file_id?: string;
}> => {
  const formData = new FormData();
  formData.append("file", file);
  return request.post(`${TTS_BASE_URL}/api/tasks/upload`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
};

export const identifyTtsBatch = (paths: string[]): Promise<{
  success: boolean;
  results: Array<{
    filename: string;
    full_path: string;
    title: string;
    author: string;
  }>;
}> => {
  return request.post(`${TTS_BASE_URL}/api/tasks/identify-batch`, { paths });
};

export const createTtsBatchTasks = (files: Array<{
  full_path: string;
  title: string;
  author: string;
  voice: string;
  file_id?: string;
  temp_path?: string;
}>): Promise<{ success: boolean; count: number }> => {
  return request.post(`${TTS_BASE_URL}/api/tasks/batch-create`, { files });
};

export const getTtsTasks = (): Promise<{ tasks: TtsTask[] }> => {
  return request.get(`${TTS_BASE_URL}/api/tasks/`);
};

export const pauseTtsTask = (id: string) => {
  return request.post(`${TTS_BASE_URL}/api/tasks/${id}/pause`);
};

export const resumeTtsTask = (id: string) => {
  return request.post(`${TTS_BASE_URL}/api/tasks/${id}/resume`);
};

export const deleteTtsTask = (id: string) => {
  return request.delete(`${TTS_BASE_URL}/api/tasks/${id}`);
};

export const getTtsPreviewUrl = (voice: string) => {
  return `${TTS_BASE_URL}/api/tasks/preview?voice=${voice}&t=${Date.now()}`;
};
