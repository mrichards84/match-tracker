import type { Match, MatchFormat } from '@/db/schema';

export function getMatchPitchCount(format: MatchFormat, customCount?: number): number {
  if (format === 'custom' && customCount && customCount > 0) {
    return customCount;
  }
  switch (format) {
    case '3v3':
      return 3;
    case '5v5':
      return 5;
    case '7v7':
      return 7;
    case '9v9':
      return 9;
    case '11v11':
      return 11;
    case 'custom':
    default:
      return customCount || 7;
  }
}

export function calculateTargetPitchSeconds(params: {
  targetPeriods: number;
  periodDurationMinutes: number;
  squadSize: number;
  playersOnPitch: number;
}): number {
  const { targetPeriods, periodDurationMinutes, squadSize, playersOnPitch } = params;
  const totalMatchSeconds = Math.max(0, targetPeriods * periodDurationMinutes * 60);
  if (squadSize <= 0) return 0;
  if (squadSize <= playersOnPitch) return totalMatchSeconds;
  return Math.round((playersOnPitch * totalMatchSeconds) / squadSize);
}

export function getMatchTargetPitchSeconds(match: Match): number {
  if (typeof match.targetPlayerPitchSeconds === 'number' && match.targetPlayerPitchSeconds > 0) {
    return match.targetPlayerPitchSeconds;
  }
  const squadSize =
    match.matchdaySquadPlayerIds?.length ||
    (match.startingGoalkeeperId ? 1 : 0) +
      match.startingOutfieldPlayerIds.length +
      match.benchPlayerIds.length;
  const playersOnPitch =
    match.playersOnPitch || getMatchPitchCount(match.format, match.customPlayersOnPitch);
  return calculateTargetPitchSeconds({
    targetPeriods: match.targetPeriods,
    periodDurationMinutes: match.periodDurationMinutes,
    squadSize,
    playersOnPitch
  });
}

