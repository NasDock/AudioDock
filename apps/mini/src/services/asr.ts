import Taro from '@tarojs/taro'
import { getBaseURL } from '../utils/request'

interface AsrResponse {
  text?: string
}

export const speechToText = async (audioFilePath: string): Promise<string> => {
  const baseURL = getBaseURL()
  if (!baseURL) {
    throw new Error('ASR base URL is not configured')
  }

  const token = Taro.getStorageSync('token')
  const uploadResult = await Taro.uploadFile({
    url: `${baseURL}/asr`,
    filePath: audioFilePath,
    name: 'audio',
    header: token ? { Authorization: `Bearer ${token}` } : undefined
  })

  if (uploadResult.statusCode < 200 || uploadResult.statusCode >= 300) {
    throw new Error(`ASR request failed with status ${uploadResult.statusCode}`)
  }

  let parsed: AsrResponse | null = null
  try {
    parsed = JSON.parse(uploadResult.data || '{}') as AsrResponse
  } catch {
    throw new Error('ASR response is not valid JSON')
  }

  const text = (parsed?.text || '').trim()
  if (!text) {
    throw new Error('ASR response missing text')
  }

  return text
}
