export { authApi } from './auth';
export { userApi } from './user';
export { trackApi } from './track';
export { albumApi } from './album';
export { artistApi } from './artist';
export { playlistApi } from './playlist';
export { collectionApi } from './collection';
export { mvApi } from './mv';
export { userDataApi } from './userData';
export { plusApi, setPlusAuthToken, getPlusAuthToken } from './plus';
export { miApi } from './mi';
export { ttsApi } from './tts';
export { ttsConfigApi } from './ttsConfig';
export { taskApi } from './task';
export { deviceApi } from './device';
export { scanLoginApi, subscribeScanLoginSession, reportScanLoginResultViaSocket } from './scanLogin';

export type { LoginDto, RegisterDto, AuthMe, LoginResponse, CheckResponse, AuthApi } from './auth';
export type { UserItem, UserApi } from './user';
export type {
  TrackDto, LikedByUser, PlaybackQuality, TrackApi,
  TrackLoadMoreParams, TrackSearchParams, TrackLatestParams,
} from './track';
export type {
  AlbumDto, AlbumTracksResp, AlbumListResp, AlbumApi,
  AlbumLoadMoreParams, AlbumLatestParams, AlbumRecommendParams,
} from './album';
export type {
  ArtistDto, ArtistApi,
  ArtistLoadMoreParams, ArtistLatestParams,
} from './artist';
export type { PlaylistDto, PlaylistDetailResp, PlaylistApi } from './playlist';
export type {
  CollectionDto, CollectionDetailResp, CollectionAlbumItem, CollectionApi,
} from './collection';
export type { MVDto, MVListParams, MVApi } from './mv';
export type {
  UserDataApi, LoadMoreQuery,
  TrackLikeItem, AlbumLikeItem, TrackHistoryItem, AlbumHistoryItem,
} from './userData';
export type {
  MiDevice, MiDevicesResponse, MiAuthStatusResponse,
  MiQRCodeResponse, MiQRCodeStatusResponse, MiPlayByUrlResponse,
  MiTrackPayload, MiPlayPlaylistResponse, MiApi,
  MiKeyword, MiKeywordsResponse, MiPageQuery,
  MiConversation, MiCastRecord, MiPagedResponse,
  MiSimpleResponse, MiAddKeywordResponse, MiKeywordPatch,
} from './mi';
export type {
  TtsProvider, TtsVoice, TtsFileItem, TtsReviewItem, TtsTask,
  TtsProvidersResp, TtsVoicesResp, TtsLocalFilesResp,
  TtsIdentifyResult, TtsIdentifyBatchResp,
  TtsBatchCreateFile, TtsBatchCreateResp, TtsTasksResp, TtsApi,
} from './tts';
export type {
  TtsProviderOption, TtsProviderConfig,
  TtsSupportedProvidersResp, TtsProviderConfigsResp,
  TtsProviderConfigResp, TtsProviderTestResp, TtsConfigApi,
} from './ttsConfig';
export type {
  TaskStatus, ImportTaskType, ImportTaskMode,
  ImportTask, CreateTaskParams, CreateTaskResponse,
  UnifiedTaskStatus, UnifiedTaskCategory, UnifiedTask,
  TaskApi,
} from './task';
export {
  toUnifiedFromImport, isTaskActive, TASK_STATUS_I18N_KEY,
} from './task';
export type { OnlineDevice, DevicePlatform, DeviceApi } from './device';
export type {
  ScanLoginSourceConfig, ScanLoginSourceBundle,
  ScanLoginAuthBundle, ScanLoginPlusBundle, ScanLoginUser,
  ScanLoginSession, ScanLoginStatusName, ScanLoginSessionStatus,
  ScanLoginClaimPayload, ScanLoginConfirmResult, ScanLoginSelection,
  ScanLoginApi, ScanLoginSubscribeOptions, ScanLoginUnsubscribe,
} from './scanLogin';
