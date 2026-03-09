import { PrismaClient, TrackType } from '@soundx/db';

function toCompletionPercent(progress: number, duration: number | null): number {
  if (duration && duration > 0) {
    const safeProgress = Math.min(Math.max(progress, 0), duration);
    return (safeProgress / duration) * 100;
  }
  return progress > 0 ? 100 : 0;
}

export async function getTrackHeartbeatScoreMap(
  prisma: PrismaClient,
  userId: number,
  type?: TrackType,
): Promise<Map<number, number>> {
  const tracks = await prisma.track.findMany({
    where: { status: 'ACTIVE', ...(type ? { type } : {}) },
    select: { id: true, duration: true },
  });

  if (tracks.length === 0) {
    return new Map();
  }

  const trackIds = tracks.map((item) => item.id);
  const durationMap = new Map<number, number | null>(
    tracks.map((item) => [item.id, item.duration ?? null]),
  );
  const scoreFromTrackHistory = new Map<number, number>();

  const userTrackHistories = await prisma.userTrackHistory.findMany({
    where: { userId, trackId: { in: trackIds } },
    select: { trackId: true, progress: true },
  });

  for (const item of userTrackHistories) {
    const completion = toCompletionPercent(
      item.progress,
      durationMap.get(item.trackId) ?? null,
    );
    scoreFromTrackHistory.set(
      item.trackId,
      (scoreFromTrackHistory.get(item.trackId) ?? 0) + completion,
    );
  }

  const scoreFromAudiobookHistory = new Map<number, number>();
  const userAudiobookHistories = await prisma.userAudiobookHistory.findMany({
    where: { userId, trackId: { in: trackIds } },
    select: { trackId: true, progress: true },
  });

  for (const item of userAudiobookHistories) {
    const completion = toCompletionPercent(
      item.progress,
      durationMap.get(item.trackId) ?? null,
    );
    scoreFromAudiobookHistory.set(
      item.trackId,
      (scoreFromAudiobookHistory.get(item.trackId) ?? 0) + completion,
    );
  }

  const scoreMap = new Map<number, number>();
  for (const trackId of trackIds) {
    const trackHistoryScore = scoreFromTrackHistory.get(trackId) ?? 0;
    const audiobookHistoryScore = scoreFromAudiobookHistory.get(trackId) ?? 0;
    scoreMap.set(trackId, Math.max(trackHistoryScore, audiobookHistoryScore));
  }

  return scoreMap;
}
