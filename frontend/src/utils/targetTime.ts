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

export function calculateDayPitchStats(params: {
  matches: Match[];
  squadSize: number;
}): {
  totalDayMatchSeconds: number;
  totalDayPitchCapacitySeconds: number;
  targetDayPitchSeconds: number;
} {
  const { matches, squadSize } = params;
  if (!matches || matches.length === 0) {
    return {
      totalDayMatchSeconds: 0,
      totalDayPitchCapacitySeconds: 0,
      targetDayPitchSeconds: 0
    };
  }

  let totalDayMatchSeconds = 0;
  let totalDayPitchCapacitySeconds = 0;

  for (const m of matches) {
    const matchSecs = Math.max(0, m.targetPeriods * m.periodDurationMinutes * 60);
    const pitchCount = m.playersOnPitch || getMatchPitchCount(m.format, m.customPlayersOnPitch);
    totalDayMatchSeconds += matchSecs;
    totalDayPitchCapacitySeconds += pitchCount * matchSecs;
  }

  let targetDayPitchSeconds = 0;
  if (squadSize > 0) {
    targetDayPitchSeconds = Math.min(
      totalDayMatchSeconds,
      Math.round(totalDayPitchCapacitySeconds / squadSize)
    );
  }

  return {
    totalDayMatchSeconds,
    totalDayPitchCapacitySeconds,
    targetDayPitchSeconds
  };
}

export function getPlayerSecondsInMatch(
  match: Match,
  playerId: string,
  liveCurrentSeconds?: number
): number {
  let total = 0;
  if (!match.stints) return 0;
  for (const stint of match.stints) {
    if (stint.playerId === playerId) {
      const endSec = stint.endSecond ?? (liveCurrentSeconds ?? match.elapsedSeconds);
      total += Math.max(0, endSec - stint.startSecond);
    }
  }
  return total;
}

export function getPlayerDaySeconds(
  matches: Match[],
  currentMatchId: string,
  playerId: string,
  currentMatchLiveSeconds: number
): number {
  let total = 0;
  for (const m of matches) {
    if (m.id === currentMatchId) {
      total += getPlayerSecondsInMatch(m, playerId, currentMatchLiveSeconds);
    } else {
      total += getPlayerSecondsInMatch(m, playerId);
    }
  }
  return total;
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
