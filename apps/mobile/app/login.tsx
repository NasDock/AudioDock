import { MaterialIcons } from "@expo/vector-icons";
import { SOURCEMAP, SOURCETIPSMAP } from "@soundx/services";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../src/context/ThemeContext";

const logo = require("../assets/images/logo.png");
const subsonicLogo = require("../assets/images/subsonic.png");
const embyLogo = require("../assets/images/emby.png");

export default function LoginSelectionScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const getLogo = (key: string) => {
    switch (key) {
      case "Emby": return embyLogo;
      case "Subsonic": return subsonicLogo;
      default: return logo;
    }
  };

  const handleSelect = (type: string) => {
    router.push({
      pathname: "/login-form",
      params: { type, adding: params.adding },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
            <Image source={logo} style={styles.appLogo} />
            <Text style={[styles.title, { color: colors.text }]}>选择数据源类型</Text>
            <Text style={[styles.subtitle, { color: colors.secondary }]}>
                请选择您要连接的服务器类型
            </Text>
        </View>

        <View style={styles.list}>
          {Object.keys(SOURCEMAP).map((key) => {
            const isDisabled = false;
            
            return (
              <TouchableOpacity
                key={key}
                style={[
                    styles.card, 
                    { backgroundColor: colors.card, borderColor: colors.border },
                    isDisabled && { opacity: 0.5 }
                ]}
                onPress={() => !isDisabled && handleSelect(key)}
                disabled={isDisabled}
              >
                <View style={styles.cardContent}>
                    <Image source={getLogo(key)} style={styles.cardIcon} />
                    <View style={styles.cardText}>
                        <Text style={[styles.cardTitle, { color: colors.text }]}>{key}</Text>
                        <Text style={[styles.cardDesc, { color: colors.secondary }]} numberOfLines={2}>
                            {SOURCETIPSMAP[key as keyof typeof SOURCETIPSMAP]}
                        </Text>
                    </View>
                    <View style={styles.arrow}>
                        <MaterialIcons name="chevron-right" size={28} color={colors.text} />
                    </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    flexGrow: 1,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginVertical: 40,
  },
  appLogo: {
    width: 100,
    height: 100,
    borderRadius: 16,
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 12,
    textAlign: 'center',
  },
  list: {
    gap: 15,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    // Shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIcon: {
    width: 50,
    height: 50,
    marginRight: 15,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 12,
  },
  arrow: {
    marginLeft: 10,
  },
});
