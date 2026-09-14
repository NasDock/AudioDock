export { HarmonyHttpClient, httpClient } from './src/main/ets/HarmonyHttpClient';
export { HttpError } from './src/main/ets/HttpError';
export { authApi, userApi, trackApi, albumApi, artistApi, playlistApi, collectionApi, mvApi, userDataApi,
  plusApi, setPlusAuthToken, getPlusAuthToken, miApi, ttsApi, ttsConfigApi, taskApi, deviceApi,
  scanLoginApi, subscribeScanLoginSession, reportScanLoginResultViaSocket }
  from './src/main/ets/api';
export type {
  RequestConfig, HttpResponse,
  BackendEnvelope, LoadMoreResp, TableResp,
  RequestInterceptor, ResponseInterceptor, ErrorInterceptor,
} from './src/main/ets/types';
export type { LoginDto, RegisterDto, AuthMe, LoginResponse, CheckResponse, UserItem }
  from './src/main/ets/api';
export type { AuthApi, UserApi } from './src/main/ets/api';
export type {
  TrackDto, LikedByUser, PlaybackQuality, TrackApi,
  TrackLoadMoreParams, TrackSearchParams, TrackLatestParams,
} from './src/main/ets/api';
export type {
  AlbumDto, AlbumTracksResp, AlbumListResp, AlbumApi,
  AlbumLoadMoreParams, AlbumLatestParams, AlbumRecommendParams,
} from './src/main/ets/api';
export type {
  ArtistDto, ArtistApi,
  ArtistLoadMoreParams, ArtistLatestParams,
} from './src/main/ets/api';
export type { PlaylistDto, PlaylistDetailResp, PlaylistApi } from './src/main/ets/api';
export type {
  CollectionDto, CollectionDetailResp, CollectionAlbumItem, CollectionApi,
} from './src/main/ets/api';
export type { MVDto, MVListParams, MVApi } from './src/main/ets/api';
export type {
  UserDataApi, LoadMoreQuery,
  TrackLikeItem, AlbumLikeItem, TrackHistoryItem, AlbumHistoryItem,
} from './src/main/ets/api';
export type {
  PlusApi, PlusLoginResponse, PlusUserProfile, PlusSendEmailCodeResult,
  VipCurrentLowestPriceData,
  VipPlanPrice, CouponItem, CreatePaymentResponse, WechatPayPayload,
} from './src/main/ets/api/plus';
export type {
  MiDevice, MiDevicesResponse, MiAuthStatusResponse,
  MiQRCodeResponse, MiQRCodeStatusResponse, MiPlayByUrlResponse,
  MiTrackPayload, MiPlayPlaylistResponse, MiApi,
  MiKeyword, MiKeywordsResponse, MiPageQuery,
  MiConversation, MiCastRecord, MiPagedResponse,
  MiSimpleResponse, MiAddKeywordResponse, MiKeywordPatch,
} from './src/main/ets/api';
export type {
  TtsProvider, TtsVoice, TtsFileItem, TtsReviewItem, TtsTask,
  TtsProvidersResp, TtsVoicesResp, TtsLocalFilesResp,
  TtsIdentifyResult, TtsIdentifyBatchResp,
  TtsBatchCreateFile, TtsBatchCreateResp, TtsTasksResp, TtsApi,
} from './src/main/ets/api';
export type {
  TtsProviderOption, TtsProviderConfig,
  TtsSupportedProvidersResp, TtsProviderConfigsResp,
  TtsProviderConfigResp, TtsProviderTestResp, TtsConfigApi,
} from './src/main/ets/api';
export type {
  TaskStatus, ImportTaskType, ImportTaskMode,
  ImportTask, CreateTaskParams, CreateTaskResponse,
  UnifiedTaskStatus, UnifiedTaskCategory, UnifiedTask,
  TaskApi,
} from './src/main/ets/api';
export {
  toUnifiedFromImport, isTaskActive, TASK_STATUS_I18N_KEY,
} from './src/main/ets/api';
export type {
  ScanLoginSourceConfig, ScanLoginSourceBundle,
  ScanLoginAuthBundle, ScanLoginPlusBundle, ScanLoginUser,
  ScanLoginSession, ScanLoginStatusName, ScanLoginSessionStatus,
  ScanLoginClaimPayload, ScanLoginConfirmResult, ScanLoginSelection,
  ScanLoginApi, ScanLoginSubscribeOptions, ScanLoginUnsubscribe,
} from './src/main/ets/api';
export type { OnlineDevice, DevicePlatform, DeviceApi } from './src/main/ets/api';
