import { Ionicons } from "@expo/vector-icons";
import {
    addSearchRecord,
    clearSearchHistory,
    getHotSearches,
    getSearchHistory,
    searchAlbums,
    searchArtists,
    searchTracks,
    speechToText,
    toggleAlbumLike,
    toggleAlbumUnLike,
    toggleTrackLike,
    toggleTrackUnLike,
    UserAlbumLike,
    UserTrackLike
} from "@soundx/services";
import { Audio } from "expo-av";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Keyboard,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AddToPlaylistModal } from "../src/components/AddToPlaylistModal";
import { useAuth } from "../src/context/AuthContext";
import { usePlayer } from "../src/context/PlayerContext";
import { useTheme } from "../src/context/ThemeContext";
import { Album, Artist, Track } from "../src/models";
import { getImageUrl } from "../src/utils/image";
import { usePlayMode } from "../src/utils/playMode";

export default function SearchScreen() {
  const { colors } = useTheme();
  const { mode } = usePlayMode();
  const { playTrack } = usePlayer();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{
    tracks: Track[];
    artists: Artist[];
    albums: Album[];
  }>({
    tracks: [],
    artists: [],
    albums: [],
  });
  const [history, setHistory] = useState<string[]>([]);
  const [hotSearches, setHotSearches] = useState<{ keyword: string; count: number }[]>([]);

  // Add to Playlist Modal State
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<number | string | null>(null);

  // Recording state
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    return () => {
      if (recording) {
        recording.stopAndUnloadAsync().catch((err) => {
          // Ignored: already unloaded or not prepared
        });
      }
    };
  }, [recording]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height || 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const startRecording = async () => {
    try {
      // Cleanup existing recording if any to prevent "Only one Recording object" error
      if (recording) {
        try {
          await recording.stopAndUnloadAsync();
        } catch (e) {
          // ignore cleanup errors
        }
        setRecording(null);
      }

      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert(
          "需要麦克风权限",
          "我们将用于语音输入关键字，无需手动输入即可快速输入"
        );
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(newRecording);
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording", err);
      setIsRecording(false);
      setRecording(null);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    setIsRecording(false);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);

      if (uri) {
        setLoading(true);
        const text = await speechToText(uri);
        if (text && text.trim()) {
          setKeyword(text.trim());
        }
      }
    } catch (err) {
      console.error("Failed to stop recording", err);
    } finally {
      setLoading(false);
      // Reset audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });
    }
  };

  useEffect(() => {
    fetchSearchMeta();
  }, []);

  const fetchSearchMeta = async () => {
    try {
      const [hRes, hotRes] = await Promise.all([
        getSearchHistory(),
        getHotSearches()
      ]);
      if (hRes.code === 200) setHistory(hRes.data);
      if (hotRes.code === 200) setHotSearches(hotRes.data);
    } catch (e) {
      console.error("Failed to fetch search meta:", e);
    }
  };

  const clearHistory = async () => {
    try {
      await clearSearchHistory();
      setHistory([]);
    } catch (e) {
      console.error("Failed to clear history:", e);
    }
  };

  const handleSelectKeyword = (kw: string) => {
    setKeyword(kw);
    // handleSearch will be triggered by useEffect
  };
  useEffect(() => {
    if (keyword.trim().length > 0) {
      const timer = setTimeout(() => {
        handleSearch();
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setResults({ tracks: [], artists: [], albums: [] });
    }
  }, [keyword]);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const [tracksRes, artistsRes, albumsRes] = await Promise.all([
        searchTracks(keyword, mode),
        searchArtists(keyword, mode),
        searchAlbums(keyword, mode),
      ]);

      setResults({
        tracks: tracksRes.code === 200 ? tracksRes.data : [],
        artists: artistsRes.code === 200 ? artistsRes.data : [],
        albums: albumsRes.code === 200 ? albumsRes.data : [],
      });

      // Record search
      addSearchRecord(keyword);
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleLike = async (item: any, type: string) => {
    if (!user) return;
    try {
      // Optimistic update
      const isLiked = type === 'track' 
        ? item.likedByUsers?.some((l: UserTrackLike) => l.userId === user.id)
        : item.likedByUsers?.some((l: UserAlbumLike) => l.userId === user.id);

      // Update UI state locally
      const updateList = (list: any[]) => list.map(i => {
        if (i.id === item.id) {
          const newLikedByUsers = isLiked
             ? (i.likedByUsers || []).filter((l: any) => l.userId !== user.id)
             : [...(i.likedByUsers || []), { userId: user.id }];
          return { ...i, likedByUsers: newLikedByUsers };
        }
        return i;
      });

      if (type === 'track') {
          setResults(prev => ({ ...prev, tracks: updateList(prev.tracks) }));
          await (isLiked ? toggleTrackUnLike(item.id, user.id) : toggleTrackLike(item.id, user.id));
      } else if (type === 'album') {
          setResults(prev => ({ ...prev, albums: updateList(prev.albums) }));
          await (isLiked ? toggleAlbumUnLike(item.id, user.id) : toggleAlbumLike(item.id, user.id));
      }
      
    } catch (e) {
      console.error("Failed to toggle like", e);
      handleSearch(); // Revert on failure
    }
  };

  const renderItem = ({ item, type }: { item: any; type: string }) => {
    const coverUrl =
      type === "track" || type === "album"
        ? getImageUrl(item.cover, "https://picsum.photos/100")
        : type === "artist"
          ? getImageUrl(item.avatar, "https://picsum.photos/100")
          : "https://picsum.photos/100";

    const isLiked = user && (
       type === 'track' 
       ? item.likedByUsers?.some((l: UserTrackLike) => l.userId === user.id)
       : type === 'album'
         ? item.likedByUsers?.some((l: UserAlbumLike) => l.userId === user.id)
         : null
    );

    return (
      <TouchableOpacity
        style={[styles.item, { borderBottomColor: colors.border }]}
        onPress={() => {
          if (type === "track") {
            playTrack(item);
          } else if (type === "artist") {
            router.push(`/artist/${item.id}`);
          } else if (type === "album") {
            router.push(`/album/${item.id}`);
          }
        }}
      >
        <Image
          source={{ uri: coverUrl }}
          style={[styles.itemImage, type === "artist" && { borderRadius: 25 }]}
        />
        <View style={styles.itemInfo}>
          <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.itemSubtitle, { color: colors.secondary }]}>
            {type === "track" ? item.artist : type === "album" ? item.artist : "艺术家"}
          </Text>
        </View>
        
        {/* Right Side Buttons */}
        <View style={styles.itemActions}>
            {(type === 'track' || type === 'album') && (
                <>
                    <TouchableOpacity 
                        style={styles.actionButton}
                        onPress={() => handleToggleLike(item, type)}
                    >
                         <Ionicons 
                            name={isLiked ? "heart" : "heart-outline"} 
                            size={20} 
                            color={isLiked ? colors.primary : colors.secondary} 
                        />
                    </TouchableOpacity>
                    {type === 'track' && (
                        <TouchableOpacity 
                            style={styles.actionButton}
                            onPress={() => {
                                setSelectedTrackId(item.id);
                                setAddToPlaylistVisible(true);
                            }}
                        >
                            <Ionicons name="add-circle-outline" size={20} color={colors.secondary} />
                        </TouchableOpacity>
                    )}
                </>
            )}
             {/* Keep chevron for others or add consistent actions */}
             {type !== 'track' && (
                 <Ionicons name="chevron-forward" size={16} color={colors.secondary} />
             )}
        </View>
      </TouchableOpacity>
    );
  };

  const sections = [
    { title: "艺术家", data: results.artists, type: "artist" },
    { title: "专辑", data: results.albums, type: "album" },
    { title: "单曲", data: results.tracks, type: "track" },
  ].filter(s => s.data.length > 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={[styles.searchInputContainer, { backgroundColor: colors.card }]}>
          <Ionicons name="search" size={20} color={colors.secondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="搜索单曲，艺术家，专辑"
            placeholderTextColor={colors.secondary}
            value={keyword}
            onChangeText={setKeyword}
            autoFocus
          />
          {keyword.length > 0 && !isRecording && (
            <TouchableOpacity onPress={() => setKeyword("")} style={{ marginRight: 5 }}>
              <Ionicons name="close-circle" size={20} color={colors.secondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : keyword.trim().length === 0 ? (
        <FlatList
          data={[
            ...(history.length > 0 ? [{ type: 'history', data: history }] : []),
            ...(hotSearches.length > 0 ? [{ type: 'hot', data: hotSearches }] : []),
          ]}
          keyExtractor={(item) => item.type}
          renderItem={({ item }) => (
            <View style={styles.suggestSection}>
              <View style={styles.suggestHeader}>
                <Text style={[styles.suggestTitle, { color: colors.text }]}>
                  {item.type === 'history' ? '搜索历史' : '热搜榜'}
                </Text>
                {item.type === 'history' && (
                  <TouchableOpacity onPress={clearHistory}>
                    <Text style={{ color: colors.secondary, fontSize: 13 }}>清空</Text>
                  </TouchableOpacity>
                )}
              </View>
              {item.type === 'history' ? (
                <View style={styles.tagGroup}>
                  {(item.data as string[]).map((kw: string, i: number) => (
                    <TouchableOpacity 
                      key={i} 
                      style={[styles.tag, { backgroundColor: colors.card }]}
                      onPress={() => handleSelectKeyword(kw)}
                    >
                      <Text style={{ color: colors.text }}>{kw}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <View style={styles.hotList}>
                  {(item.data as any[]).map((hot: any, i: number) => (
                    <TouchableOpacity 
                      key={i} 
                      style={styles.hotItem}
                      onPress={() => handleSelectKeyword(hot.keyword)}
                    >
                      <Text style={[styles.rank, i < 3 && { color: colors.primary }]}>{i + 1}</Text>
                      <Text style={[styles.hotKeyword, { color: colors.text }]}>{hot.keyword}</Text>
                      {i < 3 && <View style={[styles.hotTag, { backgroundColor: colors.primary }]}><Text style={[styles.hotTagText, { color: colors.background }]}>HOT</Text></View>}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      ) : sections.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: colors.secondary }}>未找到相关结果</Text>
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) => item.title}
          renderItem={({ item: section }) => (
            <View>
              <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
              </View>
              {section.data.map((item) => (
                <View key={item.id}>
                  {renderItem({ item, type: section.type })}
                </View>
              ))}
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}

      <TouchableOpacity
        style={[
          styles.voiceButton,
          {
            backgroundColor: colors.card,
            borderColor: isRecording ? colors.primary : colors.border,
            bottom: keyboardHeight > 0 ? keyboardHeight + 12 : insets.bottom + 20,
          },
        ]}
        onPress={isRecording ? stopRecording : startRecording}
        activeOpacity={0.85}
      >
        <Ionicons
          name={isRecording ? "mic" : "mic-outline"}
          size={24}
          color={isRecording ? colors.primary : colors.secondary}
        />
      </TouchableOpacity>

      {/* Add To Playlist Modal */}
      <AddToPlaylistModal 
        visible={addToPlaylistVisible}
        trackId={selectedTrackId}
        onClose={() => setAddToPlaylistVisible(false)}
        onSuccess={() => {
            // Optional: show toast
        }}
      />
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
    paddingHorizontal: 15,
    paddingVertical: 10,
    gap: 10,
  },
  backBtn: {
    padding: 5,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 15,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    fontSize: 16,
  },
  center: {
    paddingTop: 100,
    alignItems: "center",
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    padding: 15,
    marginHorizontal: 15,
    borderBottomWidth: 0.5,
  },
  itemImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 15,
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 4,
  },
  itemSubtitle: {
    fontSize: 13,
  },
  itemActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 15
  },
  actionButton: {
      padding: 5
  },
  suggestSection: {
    paddingTop: 10,
    marginBottom: 20,
  },
  suggestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  suggestTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  tagGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 10,
  },
  tag: {
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: 20,
  },
  hotList: {
    paddingHorizontal: 20,
  },
  hotItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 15,
  },
  rank: {
    fontSize: 16,
    fontWeight: 'bold',
    width: 20,
    textAlign: 'center',
    color: '#999',
  },
  hotKeyword: {
    fontSize: 15,
    flex: 1,
  },
  hotTag: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  hotTagText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  voiceButton: {
    position: "absolute",
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
