export interface ServiceConfig {
  username?: string;
  password?: string; // For Subsonic (plaintext or hex-encoded if we want to separate)
  token?: string;    // For Native
  clientName?: string;
  baseUrl?: string;
  userId?: string;
}

let globalConfig: ServiceConfig = {
    clientName: "SoundX",
};

export const setServiceConfig = (config: Partial<ServiceConfig>) => {
  globalConfig = { ...globalConfig, ...config };
};

export const getServiceConfig = () => {
  return globalConfig;
};
