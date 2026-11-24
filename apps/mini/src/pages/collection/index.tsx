import { Album, getCollectionById, TrackingEvent as TE, TrackingFeature as TF } from '@soundx/services';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MiniPlayer from '../../components/MiniPlayer';
import { getImageUrl as buildImageUrl } from '../../utils/image';
import { trackEvent } from '../../utils/tracking';
import './index.scss';
import BottomTabBar from '../../components/BottomTabBar';

type CollectionDetail = {
  id: number | string;
  name: string;
  cover?: string | null;
  items?: Array<{ album: Album }>;
};

export default function CollectionPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = router.params;
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const collectionOpenedRef = useRef(false);

  useEffect(() => {
    if (collectionOpenedRef.current) return;
    collectionOpenedRef.current = true;
    void trackEvent({
      feature: TF.CONTENT,
      eventName: TE.CONTENT_COLLECTION_OPEN,
      metadata: { id },
    });
  }, []);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const res = await getCollectionById(String(id));
        if (res.code === 200 && res.data) {
          const data = res.data as CollectionDetail;
          setCollection(data);
          setAlbums((data.items || []).map((item) => item.album).filter(Boolean));
        }
      } catch (error) {
        console.error('Failed to load collection:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id]);

  // 占位图各页不同，这里绑死；调用点传显示尺寸（rpx 值 ≈ 目标设备像素，见 utils/image.ts）
  const getImageUrl = (url: string | null, width = 300) =>
    buildImageUrl(url, "https://picsum.photos/300/300", width);

  if (loading) return <View className='loading'><Text>Loading...</Text></View>;
  if (!collection) return <View className='error'><Text>{t('collection.notExist')}</Text></View>;

  return (
    <View className='collection-container'>
      <View className='nav-bar'>
        <View className='back-btn' onClick={() => Taro.navigateBack()}>
          <Text className='back-icon icon icon-back' />
        </View>
      </View>

      <ScrollView scrollY className='content-scroll'>
        <View className='header'>
          <Image
            src={getImageUrl(collection.cover || albums[0]?.cover || null, 600)}
            className='cover'
            mode='aspectFill' webp
          />
          <Text className='title'>{collection.name}</Text>
          <Text className='meta'>{`${albums.length} ${t('collection.albumsCount')}`}</Text>
        </View>

        <View className='album-grid'>
          {albums.map((album) => (
            <View
              key={album.id}
              className='album-card'
              onClick={() => Taro.navigateTo({ url: `/pages/album/index?id=${album.id}` })}
            >
              <Image src={getImageUrl(album.cover, 220)} className='album-cover' mode='aspectFill' webp />
              <Text className='album-name' numberOfLines={1}>{album.name}</Text>
              <Text className='album-artist' numberOfLines={1}>{album.artist}</Text>
            </View>
          ))}
        </View>
        <View className='page-bottom-spacer' />
      </ScrollView>
      <BottomTabBar />
      <MiniPlayer />
    </View>
  );
}
