import type { Player, Match, PlayerSeasonStats } from '@/db/schema';

// Computes playing seconds for a player within a single match
export function calculatePlayerMatchSeconds(match: Match, playerId: string): {
  totalSeconds: number;
  outfieldSeconds: number;
  goalkeeperSeconds: number;
  goals: number;
} {
  let outfieldSeconds = 0;
  let goalkeeperSeconds = 0;

  // Stints calculation
  for (const stint of match.stints || []) {
    if (stint.playerId === playerId) {
      // If stint is unclosed (match completed without closing, use match.elapsedSeconds)
      const endSec = stint.endSecond ?? match.elapsedSeconds;
      const duration = Math.max(0, endSec - stint.startSecond);

      if (stint.role === 'goalkeeper') {
        goalkeeperSeconds += duration;
      } else {
        outfieldSeconds += duration;
      }
    }
  }

  // Goals calculation
  const goals = (match.events || []).filter(
    (e) => e.type === 'goal_for' && e.playerId === playerId
  ).length;

  return {
    totalSeconds: outfieldSeconds + goalkeeperSeconds,
    outfieldSeconds,
    goalkeeperSeconds,
    goals
  };
}

// Computes aggregate season stats for all players in a team
export function calculateSeasonStats(players: Player[], matches: Match[]): PlayerSeasonStats[] {
  // Sort matches chronologically
  const sortedMatches = [...matches]
    .filter((m) => m.status === 'completed')
    .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt));

  const mostRecentMatch = sortedMatches[0] ?? null;

  return players.map((player) => {
    let matchesPlayed = 0;
    let totalPlayingSeconds = 0;
    let goalkeeperSeconds = 0;
    let goalsScored = 0;

    for (const match of sortedMatches) {
      const { totalSeconds, goalkeeperSeconds: gkSec, goals } = calculatePlayerMatchSeconds(match, player.id);
      
      if (totalSeconds > 0) {
        matchesPlayed += 1;
        totalPlayingSeconds += totalSeconds;
        goalkeeperSeconds += gkSec;
      }
      goalsScored += goals;
    }

    // Last match seconds
    let lastMatchPlayingSeconds = 0;
    if (mostRecentMatch) {
      const lastMatchStats = calculatePlayerMatchSeconds(mostRecentMatch, player.id);
      lastMatchPlayingSeconds = lastMatchStats.totalSeconds;
    }

    const averagePlayingSeconds = matchesPlayed > 0 
      ? Math.round(totalPlayingSeconds / matchesPlayed) 
      : 0;

    return {
      playerId: player.id,
      playerName: player.name,
      isActive: player.isActive,
      matchesPlayed,
      totalPlayingSeconds,
      averagePlayingSeconds,
      lastMatchPlayingSeconds,
      goalkeeperSeconds,
      goalsScored
    };
  });
}
