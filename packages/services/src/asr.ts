import { ISuccessResponse } from "./models";
import { asrRequest } from "./request";

/**
 * Speech to Text using the ASR service
 * @param audioUri Local URI of the audio file to upload
 */
export const speechToText = async (audioUri: string): Promise<string> => {
  const formData = new FormData();
  
  // Extract file name and type from URI
  const filename = audioUri.split("/").pop() || "audio.m4a";
  const match = /\.(\w+)$/.exec(filename);
  const type = match ? `audio/${match[1]}` : `audio/m4a`;

  formData.append("audio", {
    uri: audioUri,
    name: filename,
    type: type,
  } as any);

  const response = await asrRequest.post<ISuccessResponse<any>>("", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  const data = response.data as any;
  if (data && typeof data.text === 'string') {
    return data.text;
  }
  
  console.error("ASR Response invalid or missing text:", response.data);
  throw new Error("Failed to transcribe audio");
};
