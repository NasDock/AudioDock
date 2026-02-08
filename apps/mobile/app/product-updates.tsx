import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Markdown from "react-native-markdown-display";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../src/context/ThemeContext";
import { getLocalVersion } from "../src/utils/updateUtils";
const qcr = require("../assets/images/wechat_qr.jpg");

const GITHUB_USER = 'mmdctjj';
const GITHUB_REPO = 'AudioDock';

export default function ProductUpdatesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [updateContent, setUpdateContent] = useState("");
  const [version, setVersion] = useState("");

  const fetchLatestRelease = async () => {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/latest`
      );
      const data = await response.json();
      if (data && data.body) {
        setUpdateContent(data.body);
        setVersion(data.tag_name.replace(/^v/, ''));
      }
    } catch (error) {
      console.error("Failed to fetch product updates:", error);
      setUpdateContent("无法获取更新内容，请稍后再试。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLatestRelease();
  }, []);

  const markdownStyles = StyleSheet.create({
    body: {
      color: colors.text,
      fontSize: 15,
    },
    heading1: {
      color: colors.text,
      fontSize: 24,
      fontWeight: 'bold',
      marginVertical: 10,
    },
    heading2: {
      color: colors.text,
      fontSize: 20,
      fontWeight: 'bold',
      marginVertical: 8,
    },
    heading3: {
      color: colors.text,
      fontSize: 18,
      fontWeight: 'bold',
      marginVertical: 6,
    },
    bullet_list: {
        marginVertical: 8,
    },
    list_item: {
        marginVertical: 2,
    },
    bullet_list_icon: {
        color: colors.primary,
    },
    code_inline: {
        backgroundColor: colors.card,
        color: colors.primary,
        borderRadius: 4,
        paddingHorizontal: 4,
    },
    code_block: {
        backgroundColor: colors.card,
        color: colors.text,
        padding: 10,
        borderRadius: 8,
    },
    link: {
        color: '#007AFF',
    }
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>产品动态</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.qrSection}>
            <Image 
                source={qcr} 
                style={styles.qrCode}
                contentFit="contain"
            />
            <Text style={[styles.qrLabel, { color: colors.secondary }]}>
                官方公众号：声仓
            </Text>
        </View>
        <View style={styles.contentCard}>
          <Text style={[styles.currentVersion, { color: colors.secondary }]}>
            当前版本: v{getLocalVersion()}
          </Text>
          
          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: 40 }} />
          ) : (
            <View style={styles.updateSection}>
              <Markdown style={markdownStyles}>
                {updateContent}
              </Markdown>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 15,
    paddingBottom: 15,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  backButton: {
    padding: 5,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  contentCard: {
    marginTop: 20,
  },
  currentVersion: {
    fontSize: 14,
    marginBottom: 20,
  },
  updateSection: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 15,
  },
  qrSection: {
    alignItems: 'center',
    marginTop: 10,
    paddingVertical: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(150,150,150,0.2)',
  },
  qrCode: {
    width: 100,
    height: 100,
    borderRadius: 12,
    marginBottom: 12,
  },
  qrLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
});
