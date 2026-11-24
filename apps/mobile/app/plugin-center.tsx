import { Ionicons } from "@expo/vector-icons";
import {
  deleteMetadataPlugin,
  getMetadataPluginPriority,
  getMetadataPlugins,
  reloadMetadataPlugins,
  saveMetadataPlugins,
  setMetadataPluginPriority,
  type MetadataPluginConfig,
  type MetadataPluginTrackType,
  type MetadataPluginType,
  type MetadataPriority,
  TrackingEvent as TE,
  TrackingFeature as TF,
} from "@soundx/services";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../src/context/ThemeContext";
import { goBackOrReplace } from "../src/utils/navigation";
import { trackEvent } from "../src/services/tracking";

const TYPE_OPTIONS: MetadataPluginType[] = ["http"];
const TRACK_TYPE_OPTIONS: MetadataPluginTrackType[] = [
  "music",
  "audiobook",
  "mv",
];

const newPlugin = (): MetadataPluginConfig => ({
  id: `plugin_${Date.now().toString(36)}`,
  name: "",
  enabled: true,
  priority: 0,
  type: "http",
  endpoint: "",
  timeout: 30000,
  retry: 0,
  filter: { types: [] },
});

const cleanPlugin = (p: MetadataPluginConfig): MetadataPluginConfig => {
  const cleaned: MetadataPluginConfig = {
    id: p.id,
    name: p.name?.trim() || p.id,
    enabled: p.enabled !== false,
    priority: p.priority ?? 0,
    type: p.type,
  };
  if (p.type === "http") {
    cleaned.endpoint = p.endpoint?.trim() || undefined;
  } else if (p.type === "executable") {
    cleaned.command = p.command?.trim() || undefined;
  }
  if (p.timeout !== undefined && p.timeout !== 30000) cleaned.timeout = p.timeout;
  if (p.retry !== undefined && p.retry !== 0) cleaned.retry = p.retry;
  const types = (p.filter?.types || []).filter(Boolean);
  if (types.length > 0) {
    cleaned.filter = { types };
  }
  return cleaned;
};

export default function PluginCenterScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [plugins, setPlugins] = useState<MetadataPluginConfig[]>([]);
  const [priority, setPriority] = useState<MetadataPriority>("plugin");
  const [prioritySaving, setPrioritySaving] = useState(false);

  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    trackEvent({ feature: TF.PLUGIN, eventName: TE.PLUGIN_CENTER_OPEN });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await getMetadataPlugins();
        if (res.code === 200) {
          setPlugins((res.data || []) as MetadataPluginConfig[]);
        } else {
          Alert.alert(t("common.error"), res.message || "");
        }
      } catch (error) {
        console.warn("Failed to load metadata plugins", error);
      } finally {
        setLoading(false);
      }
      // Best-effort: load the global metadata-priority policy.
      try {
        const pr = await getMetadataPluginPriority();
        if (pr.code === 200 && pr.data) setPriority(pr.data);
      } catch (error) {
        console.warn("Failed to load metadata priority", error);
      }
    })();
  }, [t]);

  const handlePriorityChange = async (next: MetadataPriority) => {
    if (prioritySaving || next === priority) return;
    setPriority(next);
    setPrioritySaving(true);
    try {
      const res = await setMetadataPluginPriority(next);
      if (res.code === 200) {
        Alert.alert(t("settings.metadataPrioritySaved"));
      } else {
        Alert.alert(t("settings.metadataPrioritySaveFailed"), res.message || "");
        const prev = await getMetadataPluginPriority();
        if (prev.code === 200 && prev.data) setPriority(prev.data);
      }
    } catch (error) {
      Alert.alert(
        t("settings.metadataPrioritySaveFailed"),
        error instanceof Error ? error.message : String(error),
      );
      const prev = await getMetadataPluginPriority();
      if (prev.code === 200 && prev.data) setPriority(prev.data);
    } finally {
      setPrioritySaving(false);
    }
  };

  const updatePlugin = (id: string, patch: Partial<MetadataPluginConfig>) => {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };

  const updateFilter = (
    id: string,
    patch: Partial<NonNullable<MetadataPluginConfig["filter"]>>,
  ) => {
    setPlugins((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, filter: { ...(p.filter || {}), ...patch } }
          : p,
      ),
    );
  };

  const handleAdd = () => {
    setPlugins((prev) => [...prev, newPlugin()]);
  };

  const handleRemove = (id: string) => {
    Alert.alert(t("settings.pluginRemoveConfirm"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: () => setPlugins((prev) => prev.filter((p) => p.id !== id)),
      },
    ]);
  };

  const validate = (p: MetadataPluginConfig): string | null => {
    if (!p.id?.trim()) return t("settings.pluginIdRequired");
    if (!/^[A-Za-z0-9_-]+$/.test(p.id)) return t("settings.pluginIdInvalid");
    if (!TYPE_OPTIONS.includes(p.type)) return t("settings.pluginTypeInvalid");
    if (p.type === "http" && !p.endpoint?.trim())
      return t("settings.pluginEndpointRequired");
    if (p.type === "executable" && !p.command?.trim())
      return t("settings.pluginCommandRequired");
    return null;
  };

  const handleSave = async () => {
    if (plugins.length === 0) {
      Alert.alert(t("common.error"), t("settings.pluginEmpty"));
      return;
    }
    const sanitized: MetadataPluginConfig[] = [];
    for (const p of plugins) {
      const err = validate(p);
      if (err) {
        Alert.alert(t("common.error"), err);
        return;
      }
      sanitized.push(cleanPlugin(p));
    }
    setSaving(true);
    try {
      const res = await saveMetadataPlugins(sanitized);
      if (res.code === 200) {
        setPlugins((res.data || []) as MetadataPluginConfig[]);
        Alert.alert(t("settings.pluginSaveSuccess"));
      } else {
        Alert.alert(t("settings.pluginSaveFailed"), res.message || "");
      }
    } catch (error) {
      Alert.alert(
        t("settings.pluginSaveFailed"),
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReload = async () => {
    setReloading(true);
    try {
      const res = await reloadMetadataPlugins();
      if (res.code === 200) {
        setPlugins((res.data || []) as MetadataPluginConfig[]);
        Alert.alert(t("settings.pluginReloadSuccess"));
      } else {
        Alert.alert(t("settings.pluginReloadFailed"), res.message || "");
      }
    } catch (error) {
      Alert.alert(
        t("settings.pluginReloadFailed"),
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setReloading(false);
    }
  };

  const handleToggleType = (
    id: string,
    tp: MetadataPluginTrackType,
    on: boolean,
  ) => {
    setPlugins((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const current = p.filter?.types || [];
        const next = on
          ? Array.from(new Set([...current, tp]))
          : current.filter((x) => x !== tp);
        return {
          ...p,
          filter: { ...(p.filter || {}), types: next },
        };
      }),
    );
  };

  void deleteMetadataPlugin;

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
          {t("settings.pluginCenter")}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={[styles.description, { color: colors.secondary }]}>
            {t("settings.pluginCenterDescription")}
          </Text>
          <Text style={[styles.hint, { color: colors.secondary }]}>
            {t("settings.pluginCenterHint")}
          </Text>

          <View
            style={[
              styles.priorityCard,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.priorityTitle, { color: colors.text }]}>
              {t("settings.metadataPriorityTitle")}
            </Text>
            {(["plugin", "embedded"] as MetadataPriority[]).map((opt) => {
              const selected = priority === opt;
              const labelKey =
                opt === "plugin"
                  ? "settings.metadataPriorityPlugin"
                  : "settings.metadataPriorityEmbedded";
              const descKey =
                opt === "plugin"
                  ? "settings.metadataPriorityPluginDesc"
                  : "settings.metadataPriorityEmbeddedDesc";
              return (
                <TouchableOpacity
                  key={opt}
                  disabled={prioritySaving}
                  onPress={() => handlePriorityChange(opt)}
                  style={styles.priorityRow}
                >
                  <Ionicons
                    name={selected ? "radio-button-on" : "radio-button-off"}
                    size={22}
                    color={selected ? colors.primary : colors.secondary}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text
                      style={[styles.priorityLabel, { color: colors.text }]}
                    >
                      {t(labelKey)}
                    </Text>
                    <Text
                      style={[
                        styles.priorityDesc,
                        { color: colors.secondary },
                      ]}
                    >
                      {t(descKey)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : (
            <View style={{ marginTop: 12 }}>
              {plugins.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.secondary }]}>
                  {t("settings.pluginEmpty")}
                </Text>
              ) : (
                plugins.map((plugin, index) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    onUpdate={(patch) => updatePlugin(plugin.id, patch)}
                    onUpdateFilter={(patch) => updateFilter(plugin.id, patch)}
                    onToggleType={(tp, on) => handleToggleType(plugin.id, tp, on)}
                    onRemove={() => handleRemove(plugin.id)}
                    colors={colors}
                    t={t}
                    index={index}
                  />
                ))
              )}

              <View style={{ flexDirection: "row", marginTop: 24 }}>
                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    { backgroundColor: colors.primary, flex: 1 },
                  ]}
                  disabled={saving || reloading}
                  onPress={handleSave}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveButtonText}>{t("common.save")}</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.secondaryButton,
                    { borderColor: colors.border, marginLeft: 12 },
                  ]}
                  disabled={saving || reloading}
                  onPress={handleReload}
                >
                  {reloading ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Text style={{ color: colors.text, fontWeight: "600" }}>
                      {t("settings.pluginReload")}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.addButton,
                  { borderColor: colors.border, marginTop: 16 },
                ]}
                onPress={handleAdd}
                disabled={saving || reloading}
              >
                <Ionicons name="add" size={18} color={colors.primary} />
                <Text
                  style={[
                    styles.addButtonText,
                    { color: colors.primary },
                  ]}
                >
                  {t("settings.pluginAdd")}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

interface PluginCardProps {
  plugin: MetadataPluginConfig;
  onUpdate: (patch: Partial<MetadataPluginConfig>) => void;
  onUpdateFilter: (
    patch: Partial<NonNullable<MetadataPluginConfig["filter"]>>,
  ) => void;
  onToggleType: (tp: MetadataPluginTrackType, on: boolean) => void;
  onRemove: () => void;
  colors: any;
  t: (k: string, params?: Record<string, unknown>) => string;
  index: number;
}

const PluginCard: React.FC<PluginCardProps> = ({
  plugin,
  onUpdate,
  onUpdateFilter,
  onToggleType,
  onRemove,
  colors,
  t,
  index,
}) => {
  return (
    <View
      style={[
        styles.card,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>
          {t("settings.pluginIndex", { index: index + 1 })}
        </Text>
        <View style={styles.cardHeaderRight}>
          <Switch
            value={plugin.enabled}
            onValueChange={(val) => onUpdate({ enabled: val })}
          />
          <TouchableOpacity onPress={onRemove} style={{ marginLeft: 12 }}>
            <Ionicons name="trash-outline" size={20} color={colors.secondary} />
          </TouchableOpacity>
        </View>
      </View>

      <Field
        label={t("settings.pluginType")}
        value={plugin.type}
        colors={colors}
        hint={t("settings.pluginTypeFixedHint")}
      />
      {plugin.type === "http" && (
        <Field
          label={t("settings.pluginEndpoint")}
          value={plugin.endpoint || ""}
          onChangeText={(v) => onUpdate({ endpoint: v })}
          colors={colors}
          placeholder="http://localhost:18081/scrape"
        />
      )}
      {plugin.type === "executable" && (
        <Field
          label={t("settings.pluginCommand")}
          value={plugin.command || ""}
          onChangeText={(v) => onUpdate({ command: v })}
          colors={colors}
          placeholder="node plugins/my-plugin.js"
        />
      )}
      <View style={{ flexDirection: "row" }}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Field
            label={t("settings.pluginPriority")}
            value={String(plugin.priority ?? 0)}
            onChangeText={(v) => onUpdate({ priority: Number(v) || 0 })}
            colors={colors}
            keyboardType="number-pad"
          />
        </View>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Field
            label={`${t("settings.pluginTimeout")} (ms)`}
            value={String(plugin.timeout ?? 30000)}
            onChangeText={(v) =>
              onUpdate({ timeout: Math.max(1000, Number(v) || 30000) })
            }
            colors={colors}
            keyboardType="number-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label={t("settings.pluginRetry")}
            value={String(plugin.retry ?? 0)}
            onChangeText={(v) =>
              onUpdate({ retry: Math.max(0, Number(v) || 0) })
            }
            colors={colors}
            keyboardType="number-pad"
          />
        </View>
      </View>

      <Text style={[styles.subLabel, { color: colors.text }]}>
        {t("settings.pluginFilterTypes")}
      </Text>
      <View style={styles.typeRow}>
        {TRACK_TYPE_OPTIONS.map((tp) => {
          const active = (plugin.filter?.types || []).includes(tp);
          return (
            <TouchableOpacity
              key={tp}
              onPress={() => onToggleType(tp, !active)}
              style={[
                styles.typeChip,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active
                    ? `${colors.primary}22`
                    : "transparent",
                },
              ]}
            >
              <Text
                style={{
                  color: active ? colors.primary : colors.text,
                  fontWeight: "600",
                }}
              >
                {tp}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

    </View>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChangeText?: (v: string) => void;
  onPress?: () => void;
  colors: any;
  placeholder?: string;
  keyboardType?: "default" | "number-pad";
  hint?: string;
}

const Field: React.FC<FieldProps> = ({
  label,
  value,
  onChangeText,
  onPress,
  colors,
  placeholder,
  keyboardType,
  hint,
}) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
    {hint && (
      <Text style={[styles.fieldHint, { color: colors.secondary }]}>{hint}</Text>
    )}
    {onPress ? (
      <TouchableOpacity
        style={[
          styles.input,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
        onPress={onPress}
      >
        <Text style={{ color: value ? colors.text : colors.secondary }}>
          {value || placeholder || "-"}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.secondary} />
      </TouchableOpacity>
    ) : (
      <TextInput
        style={[
          styles.input,
          {
            borderColor: colors.border,
            backgroundColor: colors.card,
            color: colors.text,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.secondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
      />
    )}
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 15,
    paddingBottom: 15,
  },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  backButton: { padding: 5 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  description: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 6, opacity: 0.8 },
  priorityCard: {
    marginTop: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  priorityTitle: { fontSize: 14, fontWeight: "600", marginBottom: 10 },
  priorityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  priorityLabel: { fontSize: 14, fontWeight: "500" },
  priorityDesc: { fontSize: 12, lineHeight: 17, marginTop: 2, opacity: 0.8 },
  label: { fontSize: 14, marginBottom: 6, fontWeight: "600" },
  fieldHint: { fontSize: 12, marginBottom: 6, opacity: 0.75 },
  idText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 14, paddingHorizontal: 14, paddingVertical: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, marginBottom: 6 },
  subLabel: { fontSize: 14, marginBottom: 6, marginTop: 4, fontWeight: "600" },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  saveButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  addButtonText: { marginLeft: 6, fontSize: 15, fontWeight: "600" },
  emptyText: { textAlign: "center", marginVertical: 32, fontSize: 14 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  cardHeaderRight: { flexDirection: "row", alignItems: "center" },
  cardTitle: { fontSize: 16, fontWeight: "700", flex: 1 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 12 },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 8,
    marginBottom: 8,
  },
});
