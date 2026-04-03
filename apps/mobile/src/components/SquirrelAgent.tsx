import {
  extractIntentFromText,
  searchAll,
  speechToText,
} from "@soundx/services";
import { Audio } from "expo-av";
import { Image as ExpoImage } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSettings } from "../context/SettingsContext";
import { usePlayer } from "../context/PlayerContext";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { trackEvent } from "../services/tracking";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const SQUIRREL_SIZE = 70;

type AgentState = "idle" | "listening" | "processing" | "result";

export const SquirrelAgent: React.FC = () => {
  const { colors, theme } = useTheme();
  const { carLayoutMode } = useSettings();
  const { user, device } = useAuth();
  const [state, setState] = useState<AgentState>("idle");
  const [resultText, setResultText] = useState("");
  const [side, setSide] = useState<"left" | "right">("right");
  const {
    playNext,
    playPrevious,
    pause,
    resume,
    startRadioMode,
    playTrackList,
    reset,
  } = usePlayer();

  // Animation values
  // We'll use two separate views to avoid the useNativeDriver conflict
  const pan = useRef(
    new Animated.ValueXY({
      x: SCREEN_WIDTH - SQUIRREL_SIZE - 10,
      y: SCREEN_HEIGHT / 2,
    }),
  ).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const bubbleOpacity = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  // Recording refs
  const recordingRef = useRef<Audio.Recording | null>(null);
  const silenceTimerRef = useRef<any>(null);

  // Pan Responder for dragging
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,

      onMoveShouldSetPanResponder: (e, gestureState) => {
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },

      onPanResponderGrant: () => {
        pan.setOffset({
          x: (pan.x as any)._value,
          y: (pan.y as any)._value,
        });
        pan.setValue({ x: 0, y: 0 });
      },

      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),

      onPanResponderRelease: (e, gestureState) => {
        pan.flattenOffset();

        const targetX = carLayoutMode
          ? 10
          : gestureState.moveX > SCREEN_WIDTH / 2
            ? SCREEN_WIDTH - SQUIRREL_SIZE - 10
            : 10;

        setSide(carLayoutMode ? "left" : gestureState.moveX > SCREEN_WIDTH / 2 ? "right" : "left");

        Animated.spring(pan, {
          toValue: { x: targetX, y: (pan.y as any)._value },
          useNativeDriver: false,
        }).start();
      },
    }),
  ).current;

  useEffect(() => {
    if (state === "listening") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [state]);

  useEffect(() => {
    if (carLayoutMode) {
      setSide("left");
      Animated.spring(pan, {
        toValue: { x: 10, y: (pan.y as any)._value || SCREEN_HEIGHT / 2 },
        useNativeDriver: false,
      }).start();
    }
  }, [carLayoutMode, pan]);
  
  useEffect(() => {
    if (state === "processing") {
      rotateAnim.setValue(0);
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ).start();
    } else {
      rotateAnim.stopAnimation();
    }
  }, [state]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const startRecording = async () => {
    try {
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }

      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== "granted") return;

      await pause();
      await new Promise((r) => setTimeout(r, 120));

      const recording = new Audio.Recording();

      await recording.prepareToRecordAsync({
        web: {
          mimeType: "audio/webm",
          bitsPerSecond: 128000,
        },
        ios: {
          extension: ".m4a",
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        android: {
          extension: ".m4a",
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
      });

      await recording.startAsync();

      recordingRef.current = recording;
      setState("listening");
      trackEvent({
        feature: "voice",
        eventName: "voice_assistant_use",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
      });
    } catch (err) {
      console.error("Recording failed", err);
      setState("idle");
    }
  };
  const stopRecording = async () => {
    if (!recordingRef.current) return;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    setState("processing");
    try {
      await recordingRef.current.stopAndUnloadAsync();

      await new Promise((r) => setTimeout(r, 150));

      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (uri) {
        let text = await speechToText(uri);
        if (text) {
          const intentData = await extractIntentFromText(text);
          if (intentData && intentData.text && intentData.prompt) {
            text = intentData.text;
            const actionPrompt = intentData.prompt;
            console.log("Extracted action:", actionPrompt);

            // Handle Action Prompt
            setTimeout(async () => {
              try {
                if (actionPrompt === "next") await playNext();
                else if (actionPrompt === "last") {
                  await playPrevious();
                  await resume();
                } else if (actionPrompt === "pause") await pause();
                else if (actionPrompt === "play") await resume();
                else if (actionPrompt === "random") {
                  await startRadioMode();
                  await resume();
                } else if (actionPrompt.startsWith("song_")) {
                  const keyword = actionPrompt.replace("song_", "");
                  const searchRes = await searchAll(keyword);
                  console.log(searchRes, "song");
                  if (searchRes.tracks && searchRes.tracks.length > 0) {
                    await playTrackList(searchRes.tracks, 0);
                  }
                } else if (actionPrompt.startsWith("alum_")) {
                  const keyword = actionPrompt.replace("alum_", "");
                  const searchRes = await searchAll(keyword);
                  console.log(searchRes, "alum");
                  if (searchRes.albums && searchRes.albums.length > 0) {
                    // Can't directly play album, fallback to tracks search with album keyword
                    const trackRes = await searchAll(keyword);
                    if (trackRes.tracks && trackRes.tracks.length > 0) {
                      await playTrackList(trackRes.tracks, 0);
                    }
                  }
                } else if (actionPrompt.startsWith("arist_")) {
                  const keyword = actionPrompt.replace("arist_", "");
                  const searchRes = await searchAll(keyword);
                  console.log(searchRes, "arist");
                  if (searchRes.tracks && searchRes.tracks.length > 0) {
                    await playTrackList(searchRes.tracks, 0);
                  }
                } else if (actionPrompt.startsWith("list_")) {
                  const keyword = actionPrompt.replace("list_", "");
                  const searchRes = await searchAll(keyword);
                  if (searchRes.tracks && searchRes.tracks.length > 0) {
                    await playTrackList(searchRes.tracks, 0);
                  }
                }
              } catch (e) {
                console.error("Action execution failed", e);
              }
            }, 100);
          } else {
            text = "我没有听懂，请再试一次";
          }
        }
        setResultText(text);
        setState("result");

        Animated.timing(bubbleOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();

        setTimeout(() => {
          Animated.timing(bubbleOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }).start(() => {
            setState("idle");
            const currentX = (pan.x as any)._value;
            const targetX =
              currentX > SCREEN_WIDTH / 2
                ? SCREEN_WIDTH - SQUIRREL_SIZE - 10
                : 10;
            setSide(currentX > SCREEN_WIDTH / 2 ? "right" : "left");
            Animated.spring(pan, {
              toValue: { x: targetX, y: (pan.y as any)._value },
              useNativeDriver: false,
            }).start();
          });
        }, 6000);
      } else {
        setState("idle");
      }
    } catch (err) {
      console.error("Agent failed to stop recording", err);
      setState("idle");
    }
  };

  const handlePress = () => {
    if (state === "idle") {
      const currentX = (pan.x as any)._value;
      const targetSide = currentX > SCREEN_WIDTH / 2 ? "right" : "left";
      setSide(targetSide);
      const targetX =
        targetSide === "right" ? SCREEN_WIDTH - SQUIRREL_SIZE - 40 : 40;

      Animated.spring(pan, {
        toValue: { x: targetX, y: (pan.y as any)._value },
        useNativeDriver: false,
      }).start();

      startRecording();
    } else if (state === "listening") {
      stopRecording();
    }
  };

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeIOS: 1, // mix
      shouldDuckAndroid: true,
    });
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Outer wrapper for Translation (Pan) - useNativeDriver: false */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.container,
          {
            transform: [{ translateX: pan.x }, { translateY: pan.y }],
          },
        ]}
      >
        {state === "result" && resultText && (
          <Animated.View
            style={[
              styles.bubble,
              { backgroundColor: colors.card + "f2", opacity: bubbleOpacity },
              side === "left"
                ? { left: 0, borderBottomLeftRadius: 2 }
                : { right: 0, borderBottomRightRadius: 2 },
            ]}
          >
            <Text style={[styles.bubbleText, { color: colors.text }]}>
              {resultText}
            </Text>
          </Animated.View>
        )}

        <TouchableOpacity activeOpacity={0.8} onPress={handlePress}>
          {/* Inner wrapper for Scale (Pulse) - useNativeDriver: true */}
          <Animated.View
            style={[
              styles.squirrelWrapper,
              {
                backgroundColor:
                  theme === "festive" ? "#D4AF37" : colors.primary + "33",
                transform: [{ scale: pulseAnim }],
              },
            ]}
          >
            <ExpoImage
              source={require('../../assets/dexopt/squirrel.svg')}
              style={styles.squirrel}
              contentFit="contain"
            />
            {state === "processing" && (
              <Animated.View 
                style={[
                  styles.processingDot, 
                  { transform: [{ rotate: spin }] }
                ]} 
              />
            )}
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    width: SQUIRREL_SIZE,
    height: SQUIRREL_SIZE,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  squirrelWrapper: {
    width: SQUIRREL_SIZE,
    height: SQUIRREL_SIZE,
    borderRadius: SQUIRREL_SIZE / 2,
    padding: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  squirrelPlaceholder: {
    width: "100%",
    height: "100%",
  },
  squirrel: {
    width: "100%",
    height: "100%",
  },
  bubble: {
    position: "absolute",
    bottom: SQUIRREL_SIZE + 20,
    minWidth: 250,
    maxWidth: 300,
    padding: 14,
    borderRadius: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  indicator: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#FFF",
  },
  processingDot: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: SQUIRREL_SIZE / 2,
    borderWidth: 3,
    borderColor: "#FFD700",
    borderStyle: "dashed",
  },
});
