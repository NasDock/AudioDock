import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../src/context/ThemeContext";
import { playerThemeStore, usePlayerThemeState } from "../src/store/playerTheme";
import { goBackOrReplace } from "../src/utils/navigation";

/** 与 player.tsx / usePlayerTheme 同一口径的本地 VIP 判定 */
const useLocalVipStatus = (): boolean => {
  const [vip, setVip] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await AsyncStorage.getItem("plus_vip_status");
        const data = await AsyncStorage.getItem("plus_vip_data");
        let v = status === "true";
        if (!v && data) {
          try {
            const parsed = JSON.parse(data);
            v = !!(parsed?.vipTier && parsed.vipTier !== "NONE");
          } catch {}
        }
        if (!cancelled) setVip(v);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return vip;
};

export default function PlayerThemeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { themes, order, activeId } = usePlayerThemeState();
  const isVip = useLocalVipStatus();

  const [jsonText, setJsonText] = useState("");

  const handleImport = () => {
    const text = jsonText.trim();
    if (!text) return;
    const result = playerThemeStore.importTheme(text);
    if (!result.ok) {
      Alert.alert(t("common.error"), result.error);
      return;
    }
    setJsonText("");
    if (result.warnings.length > 0) {
      Alert.alert(
        t("settings.playerThemeImportWarnings"),
        result.warnings.slice(0, 10).join("\n"),
      );
    } else {
      Alert.alert(t("settings.playerThemeImportSuccess"));
    }
  };

  const handlePaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) setJsonText(text);
    } catch (e) {
      console.warn("Failed to read clipboard", e);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert(t("settings.playerThemeDeleteConfirm"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: () => playerThemeStore.removeTheme(id),
      },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => goBackOrReplace(router, "/(tabs)/personal")}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t("settings.playerTheme")}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={[styles.description, { color: colors.secondary }]}>
            {t("settings.playerThemeDescription")}
          </Text>

          {!isVip && (
            <View
              style={[
                styles.vipBanner,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <Ionicons name="diamond-outline" size={18} color={colors.primary} />
              <Text style={[styles.vipBannerText, { color: colors.secondary }]}>
                {t("settings.playerThemeVipOnly")}
              </Text>
            </View>
          )}

          {/* 主题列表：默认样式 + 已导入主题 */}
          <View
            style={[
              styles.card,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <TouchableOpacity
              style={styles.themeRow}
              onPress={() => playerThemeStore.setActive(null)}
            >
              <Ionicons
                name={activeId === null ? "radio-button-on" : "radio-button-off"}
                size={22}
                color={activeId === null ? colors.primary : colors.secondary}
              />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.themeName, { color: colors.text }]}>
                  {t("settings.playerThemeDefault")}
                </Text>
                <Text style={[styles.themeMeta, { color: colors.secondary }]}>
                  {t("settings.playerThemeDefaultDescription")}
                </Text>
              </View>
            </TouchableOpacity>

            {order.map((id) => {
              const theme = themes[id];
              if (!theme) return null;
              const active = id === activeId;
              const metaLine = [
                theme.meta.author,
                theme.meta.version ? `v${theme.meta.version}` : undefined,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <View
                  key={id}
                  style={[styles.themeRow, { borderTopColor: colors.border, borderTopWidth: 1 }]}
                >
                  <TouchableOpacity
                    style={styles.themeMain}
                    onPress={() => playerThemeStore.setActive(id)}
                  >
                    <Ionicons
                      name={active ? "radio-button-on" : "radio-button-off"}
                      size={22}
                      color={active ? colors.primary : colors.secondary}
                    />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={[styles.themeName, { color: colors.text }]}>
                        {theme.meta.name}
                      </Text>
                      {!!metaLine && (
                        <Text style={[styles.themeMeta, { color: colors.secondary }]}>
                          {metaLine}
                        </Text>
                      )}
                      {!!theme.meta.description && (
                        <Text style={[styles.themeMeta, { color: colors.secondary }]}>
                          {theme.meta.description}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDelete(id)}
                    style={styles.deleteButton}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.secondary} />
                  </TouchableOpacity>
                </View>
              );
            })}

            {order.length === 0 && (
              <Text style={[styles.emptyText, { color: colors.secondary }]}>
                {t("settings.playerThemeEmpty")}
              </Text>
            )}
          </View>

          {/* 导入：粘贴 JSON */}
          <View
            style={[
              styles.card,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <TextInput
              style={[
                styles.jsonInput,
                { color: colors.text, borderColor: colors.border },
              ]}
              value={jsonText}
              onChangeText={setJsonText}
              placeholder={t("settings.playerThemeImportPlaceholder")}
              placeholderTextColor={colors.secondary}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.importActions}>
              <TouchableOpacity
                onPress={handlePaste}
                style={[styles.actionButton, { borderColor: colors.border }]}
              >
                <Ionicons name="clipboard-outline" size={16} color={colors.text} />
                <Text style={[styles.actionButtonText, { color: colors.text }]}>
                  {t("settings.playerThemePaste")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleImport}
                style={[
                  styles.actionButton,
                  styles.importButton,
                  { backgroundColor: colors.primary },
                  !jsonText.trim() && { opacity: 0.4 },
                ]}
                disabled={!jsonText.trim()}
              >
                <Text style={[styles.importButtonText, { color: colors.background }]}>
                  {t("settings.playerThemeImport")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  backButton: {
    padding: 5,
    width: 40,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  scrollContent: {
    padding: 16,
  },
  description: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  vipBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  vipBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  themeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  themeMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  themeName: {
    fontSize: 15,
    fontWeight: "600",
  },
  themeMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  deleteButton: {
    padding: 8,
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 12,
  },
  jsonInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    minHeight: 140,
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    textAlignVertical: "top",
  },
  importActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 10,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionButtonText: {
    fontSize: 13,
  },
  importButton: {
    borderWidth: 0,
  },
  importButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
