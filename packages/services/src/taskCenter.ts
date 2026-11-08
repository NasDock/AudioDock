import { getImportTasks, ImportTask, TaskStatus } from "./import";
import { getTtsTasks, TtsTask } from "./tts";

/**
 * 任务中心统一任务模型（平台无关）。
 *
 * 后端存在两套互相独立的任务系统：
 * - 导入任务（NestJS 内存 Map）：全量 / 增量 / 精简 / 数据源同步
 * - TTS 任务（Python 服务，SQLite 持久化）：TTS 有声书
 *
 * 本模块把两者归一化成 `UnifiedTask`，供三端（desktop / mobile / mini）复用。
 * 标签与状态色由展示层通过 i18n key 自行渲染，本模块不依赖 i18n / UI 框架。
 */

export type UnifiedTaskCategory =
  | "full"
  | "incremental"
  | "compact"
  | "webdav-sync"
  | "tts";

export type UnifiedTaskStatus =
  | "pending"
  | "processing"
  | "paused"
  | "success"
  | "failed";

export interface UnifiedTask {
  id: string;
  source: "import" | "tts";
  category: UnifiedTaskCategory;
  /** TTS 使用 book_name；导入类为空，展示层按 category 走 i18n 标签 */
  title: string;
  /** TTS: author；导入: currentFileName / message */
  subtitle?: string;
  status: UnifiedTaskStatus;
  /** 0-100 */
  progress: number;
  createdAt?: string;
  raw: ImportTask | TtsTask;
}

/** category → i18n key，供展示层渲染标题/分类标签 */
export const TASK_CATEGORY_I18N_KEY: Record<UnifiedTaskCategory, string> = {
  full: "taskCenter.category.full",
  incremental: "taskCenter.category.incremental",
  compact: "taskCenter.category.compact",
  "webdav-sync": "taskCenter.category.webdavSync",
  tts: "taskCenter.category.tts",
};

/** status → i18n key，供展示层渲染状态文案 */
export const TASK_STATUS_I18N_KEY: Record<UnifiedTaskStatus, string> = {
  pending: "taskCenter.status.pending",
  processing: "taskCenter.status.processing",
  paused: "taskCenter.status.paused",
  success: "taskCenter.status.success",
  failed: "taskCenter.status.failed",
};

const normalizeImportStatus = (s: TaskStatus): UnifiedTaskStatus => {
  switch (s) {
    case TaskStatus.SUCCESS:
      return "success";
    case TaskStatus.FAILED:
      return "failed";
    // INITIALIZING / PREPARING / PARSING
    default:
      return "processing";
  }
};

const normalizeTtsStatus = (s: TtsTask["status"]): UnifiedTaskStatus => {
  switch (s) {
    case "completed":
      return "success";
    case "failed":
      return "failed";
    case "paused":
      return "paused";
    case "processing":
      return "processing";
    case "pending":
    default:
      return "pending";
  }
};

const importCategory = (t: ImportTask): UnifiedTaskCategory => {
  return (t.type ?? t.mode ?? "incremental") as UnifiedTaskCategory;
};

const importProgress = (t: ImportTask, status: UnifiedTaskStatus): number => {
  if (status === "success") return 100;
  const total = t.total ?? 0;
  const current = t.current ?? 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((current / total) * 100));
};

const ttsProgress = (t: TtsTask): number => {
  const total = t.total_chapters ?? 0;
  if (total <= 0) return t.status === "completed" ? 100 : 0;
  return Math.min(
    100,
    Math.round(((t.completed_chapters ?? 0) / total) * 100)
  );
};

export const toUnifiedFromImport = (t: ImportTask): UnifiedTask => {
  const status = normalizeImportStatus(t.status);
  return {
    id: t.id,
    source: "import",
    category: importCategory(t),
    title: "",
    subtitle: t.currentFileName || t.message,
    status,
    progress: importProgress(t, status),
    createdAt: t.createdAt,
    raw: t,
  };
};

export const toUnifiedFromTts = (t: TtsTask): UnifiedTask => ({
  id: t.id,
  source: "tts",
  category: "tts",
  title: t.book_name,
  subtitle: t.author,
  status: normalizeTtsStatus(t.status),
  progress: ttsProgress(t),
  createdAt: t.created_at,
  raw: t,
});

/** 进行中：pending / processing / paused。用于入口显隐与列表高亮。 */
export const isTaskActive = (t: UnifiedTask): boolean =>
  t.status === "pending" ||
  t.status === "processing" ||
  t.status === "paused";

/**
 * 聚合两套任务系统，返回统一模型（按 createdAt 倒序）。
 * 任一来源失败都降级为空数组，保证另一来源仍可展示。
 */
export const fetchAllTasks = async (
  serverAddress?: string
): Promise<UnifiedTask[]> => {
  // 不同来源/适配器的响应包裹形态可能不同（有的返回 {code,message,data}，
  // 有的经拦截器已解到 data，甚至直接返回数组），这里统一从常见位置取数组，
  // 取不到就降级为空数组，避免 .map 崩溃。
  const pickArray = <T>(res: any, key: "data" | "tasks"): T[] => {
    if (Array.isArray(res)) return res as T[];
    const wrapped = res?.[key];
    if (Array.isArray(wrapped)) return wrapped as T[];
    // 兼容双层包裹：{ data: { data: [...] } }
    if (Array.isArray(wrapped?.[key])) return wrapped[key] as T[];
    return [];
  };

  const [importTasks, ttsTasks] = await Promise.all([
    getImportTasks(serverAddress)
      .then((res) => pickArray<ImportTask>(res, "data"))
      .catch(() => [] as ImportTask[]),
    getTtsTasks()
      .then((res) => pickArray<TtsTask>(res, "tasks"))
      .catch(() => [] as TtsTask[]),
  ]);

  const unified: UnifiedTask[] = [
    ...importTasks.map(toUnifiedFromImport),
    ...ttsTasks.map(toUnifiedFromTts),
  ];

  return unified.sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });
};

/** 是否存在进行中任务（供入口显隐用）。 */
export const hasActiveTasks = async (
  serverAddress?: string
): Promise<boolean> => {
  const tasks = await fetchAllTasks(serverAddress);
  return tasks.some(isTaskActive);
};

/**
 * 任务变更事件名。创建/暂停/恢复/删除任务后通过 notifyTasksChanged() 广播，
 * 空闲中的监听方（如 Header 任务中心入口）收到后才重新拉取一次，
 * 避免无条件定时轮询打爆 /import/tasks 与 /tts/api/tasks/。
 */
export const TASKS_CHANGED_EVENT = "soundx:tasks-changed";

/** 广播任务变更事件（仅浏览器环境生效）。 */
export const notifyTasksChanged = (): void => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
  }
};
