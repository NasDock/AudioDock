import AsyncStorage from "@react-native-async-storage/async-storage";
import { SharedSocketService } from "@soundx/ws";
import * as Device from "expo-device";
import { getDevicePlatform, getOrCreateDeviceId } from "../utils/platform";

class MobileSocketService extends SharedSocketService {
  async connectWithContext(userId: number, token: string) {
    if (this.connected) return;

    let deviceName = Device.modelName || "Mobile Device";
    const deviceId = await getOrCreateDeviceId();
    const platform = getDevicePlatform();

    // Attempt to get cached device info if needed, but expo-device is usually good
    const savedAddress = await AsyncStorage.getItem("serverAddress");

    super.connect({
      url: savedAddress || "http://localhost:3000",
      token,
      userId,
      deviceName,
      deviceId,
      platform,
    });
  }
}

export const socketService = new MobileSocketService();
