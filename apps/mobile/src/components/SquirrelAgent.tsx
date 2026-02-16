import { speechToText } from "@soundx/services";
import { Audio } from "expo-av";
import { Image as ExpoImage } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const SQUIRREL_SIZE = 70;

type AgentState = "idle" | "listening" | "processing" | "result";

export const SquirrelAgent: React.FC = () => {
  const { colors, theme } = useTheme();
  const [state, setState] = useState<AgentState>("idle");
  const [resultText, setResultText] = useState("");

  // Animation values
  // We'll use two separate views to avoid the useNativeDriver conflict
  const pan = useRef(new Animated.ValueXY({ x: SCREEN_WIDTH - SQUIRREL_SIZE - 10, y: SCREEN_HEIGHT / 2 })).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const bubbleOpacity = useRef(new Animated.Value(0)).current;

  // Recording refs
  const recordingRef = useRef<Audio.Recording | null>(null);
  const silenceTimerRef = useRef<any>(null);

  // Pan Responder for dragging
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({
          x: (pan.x as any)._value,
          y: (pan.y as any)._value
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (e, gestureState) => {
        pan.flattenOffset();
        // Stick to side logic
        const targetX = gestureState.moveX > SCREEN_WIDTH / 2 ? SCREEN_WIDTH - SQUIRREL_SIZE - 10 : 10;
        Animated.spring(pan, {
          toValue: { x: targetX, y: (pan.y as any)._value },
          useNativeDriver: false,
        }).start();
      },
    })
  ).current;

  useEffect(() => {
    if (state === "listening") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [state]);

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== "granted") return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          android: {
            ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
            extension: '.m4a',
            outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC,
          },
          ios: {
            ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
            extension: '.m4a',
            outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          },
        },
        (status) => {
          if (status.isRecording && status.metering !== undefined) {
             if (status.metering < -45) {
                if (!silenceTimerRef.current) {
                    silenceTimerRef.current = setTimeout(() => stopRecording(), 2500);
                }
             } else {
                if (silenceTimerRef.current) {
                    clearTimeout(silenceTimerRef.current);
                    silenceTimerRef.current = null;
                }
             }
          }
        },
        100
      );
      recordingRef.current = recording;
      setState("listening");
    } catch (err) {
      console.error("Agent failed to start recording", err);
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
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (uri) {
        const text = await speechToText(uri);
        setResultText(text);
        setState("result");
        
        Animated.timing(bubbleOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
        
        setTimeout(() => {
          Animated.timing(bubbleOpacity, { toValue: 0, duration: 500, useNativeDriver: true }).start(() => {
             setState("idle");
             const currentX = (pan.x as any)._value;
             const targetX = currentX > SCREEN_WIDTH / 2 ? SCREEN_WIDTH - SQUIRREL_SIZE - 10 : 10;
             Animated.spring(pan, {
                toValue: { x: targetX, y: (pan.y as any)._value },
                useNativeDriver: false
             }).start();
          });
        }, 6000);
      } else {
        setState("idle");
      }
    } catch (err) {
      console.error("Agent failed to stop recording", err);
      setState("idle");
    } finally {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    }
  };

  const handlePress = () => {
    if (state === "idle") {
      const currentX = (pan.x as any)._value;
      const targetX = currentX > SCREEN_WIDTH / 2 ? SCREEN_WIDTH - SQUIRREL_SIZE - 40 : 40;
      
      Animated.spring(pan, {
        toValue: { x: targetX, y: (pan.y as any)._value },
        useNativeDriver: false,
      }).start();
      
      startRecording();
    } else if (state === "listening") {
      stopRecording();
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Outer wrapper for Translation (Pan) - useNativeDriver: false */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.container,
          {
            transform: [
              { translateX: pan.x },
              { translateY: pan.y },
            ],
          },
        ]}
      >
        {state === "result" && resultText && (
          <Animated.View style={[styles.bubble, { backgroundColor: colors.card, opacity: bubbleOpacity }]}>
            <Text style={[styles.bubbleText, { color: colors.text }]}>{resultText}</Text>
          </Animated.View>
        )}
        
        <TouchableOpacity activeOpacity={0.8} onPress={handlePress}>
          {/* Inner wrapper for Scale (Pulse) - useNativeDriver: true */}
          <Animated.View 
            style={[
              styles.squirrelWrapper, 
              { 
                backgroundColor: theme === 'festive' ? '#D4AF37' : colors.primary + '33',
                transform: [{ scale: pulseAnim }]
              }
            ]}
          >
            <ExpoImage
              source={require("../../assets/dexopt/squirrel.svg")}
              style={styles.squirrel}
              contentFit="contain"
            />
            {state === "listening" && (
                <View style={[styles.indicator, { backgroundColor: '#FF4444' }]} />
            )}
            {state === "processing" && (
                <View style={styles.processingDot} />
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
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  squirrelWrapper: {
    width: SQUIRREL_SIZE,
    height: SQUIRREL_SIZE,
    borderRadius: SQUIRREL_SIZE / 2,
    padding: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squirrel: {
    width: '100%',
    height: '100%',
  },
  bubble: {
    position: 'absolute',
    bottom: SQUIRREL_SIZE + 10,
    minWidth: 100,
    maxWidth: 250,
    padding: 12,
    borderRadius: 15,
    borderBottomRightRadius: 2,
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
      position: 'absolute',
      top: 5,
      right: 5,
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: '#FFF'
  },
  processingDot: {
      position: 'absolute',
      width: '100%',
      height: '100%',
      borderRadius: SQUIRREL_SIZE / 2,
      borderWidth: 3,
      borderColor: '#FFD700',
      borderStyle: 'dashed',
  }
});
