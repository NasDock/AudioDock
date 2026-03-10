import { useAuth } from "@/src/context/AuthContext";
import { initBaseURL } from "@/src/https";
import { check } from "@soundx/services";
import { Stack, useSegments } from "expo-router";
import React, { useEffect } from "react";

export default function TabLayout() {
  const { logout } = useAuth();
  const segments = useSegments();
  const lastIndexRef = React.useRef<number | null>(null);
  const tabOrder = ["index", "library", "personal"];

  const currentKey = (segments[1] as string) || "index";
  const currentIndex = tabOrder.indexOf(currentKey);
  const prevIndex = lastIndexRef.current;
  const animation =
    prevIndex === null || currentIndex === -1
      ? "slide_from_right"
      : currentIndex > prevIndex
        ? "slide_from_right"
        : "slide_from_left";
  lastIndexRef.current = currentIndex;

  useEffect(() => {
    initBaseURL().then(() => {
      check().then((res) => {
        if (res.code === 401) {
          logout();
        }
      });
    });
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false, animation }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="library" />
      <Stack.Screen name="personal" />
    </Stack>
  );
}
