import { generateUUID } from '@/db';
import type { MatchFormat, PlannedSubstitution, PlannedSubChange } from '@/db/schema';
import { formatMMSS } from './formatters';

export interface MatchSetupConfig {
  id?: string;
  matchIndex: number; // 1-based (Match 1, Match 2, ...)
  opposition: string;
  format: MatchFormat;
  targetPeriods: number; // e.g. 1, 2, 4
  periodDurationMinutes: number; // e.g. 15, 20, 25
}

export type RotationFrequencySetting =
  | 'auto'
  | '5'
  | '6'
  | '7.5'
  | '8'
  | '10'
  | '12'
  | '15'
  | 'half_only';

export interface RotationPlannerInput {
  squadPlayerIds: string[]; // Attendance list (players physically present)
  gkPlayerIds: string[]; // Ordered list of players taking turns in goal
  playersOnPitch: number; // e.g. 7 for 7v7 (1 GK + 6 outfielders)
  matches: MatchSetupConfig[];
  rotationFrequency?: RotationFrequencySetting;
}

export interface SlotLineup {
  matchIndex: number;
  period: number;
  startSecond: number;
  endSecond: number;
  durationSeconds: number;
  gkPlayerId: string;
  outfieldPlayerIds: string[];
  benchPlayerIds: string[];
}

export interface PlayerRotationSummary {
  playerId: string;
  gkSeconds: number;
  outfieldSeconds: number;
  totalPlayingSeconds: number;
  benchSeconds: number;
  gkShiftsCount: number;
  outfieldShiftsCount: number;
}

export interface PlannedMatchOutput {
  matchIndex: number;
  opposition: string;
  format: MatchFormat;
  targetPeriods: number;
  periodDurationMinutes: number;
  totalDurationSeconds: number;
  startingGoalkeeperId?: string;
  startingOutfieldPlayerIds: string[];
  benchPlayerIds: string[];
  plannedSubstitutions: PlannedSubstitution[];
  slots: SlotLineup[];
}

export interface RotationPlanResult {
  matches: PlannedMatchOutput[];
  playerSummaries: PlayerRotationSummary[];
  targetPlayingSecondsPerPlayer: number;
  targetGkSecondsPerGoalkeeper: number;
  maxDisparitySeconds: number; // difference between player with most vs least minutes
  totalMatchdaySeconds: number;
  isFullyBalanced: boolean;
}

/**
 * Calculates equal playing time rotations and goalkeeper duties across 1 or more matches.
 */
export function calculateRotationPlan(input: RotationPlannerInput): RotationPlanResult {
  const { squadPlayerIds, gkPlayerIds, playersOnPitch, matches, rotationFrequency = 'auto' } = input;

  if (squadPlayerIds.length === 0 || matches.length === 0) {
    return {
      matches: [],
      playerSummaries: [],
      targetPlayingSecondsPerPlayer: 0,
      targetGkSecondsPerGoalkeeper: 0,
      maxDisparitySeconds: 0,
      totalMatchdaySeconds: 0,
      isFullyBalanced: true
    };
  }

  const effectivePlayersOnPitch = Math.min(playersOnPitch, squadPlayerIds.length);
  const targetOutfieldCount = Math.max(0, effectivePlayersOnPitch - 1);

  // 1. Calculate durations
  const matchDurationsSeconds = matches.map(
    (m) => m.targetPeriods * m.periodDurationMinutes * 60
  );
  const totalMatchdaySeconds = matchDurationsSeconds.reduce((sum, d) => sum + d, 0);

  // Target minutes per player across the day
  const totalPitchPlayerSeconds = totalMatchdaySeconds * effectivePlayersOnPitch;
  const targetPlayingSecondsPerPlayer = Math.round(
    totalPitchPlayerSeconds / squadPlayerIds.length
  );

  const effectiveGkList = gkPlayerIds.filter((id) => squadPlayerIds.includes(id));
  const targetGkSecondsPerGoalkeeper =
    effectiveGkList.length > 0
      ? Math.round(totalMatchdaySeconds / effectiveGkList.length)
      : 0;

  // 2. Generate time slots per match
  interface InternalSlot {
    matchIdx: number;
    period: number;
    startSecond: number;
    endSecond: number;
    durationSeconds: number;
    globalStartSecond: number;
  }

  const allSlots: InternalSlot[] = [];
  let currentGlobalOffset = 0;

  matches.forEach((m, mIdx) => {
    const periodDurationSec = m.periodDurationMinutes * 60;

    // Determine target slot length in seconds
    let targetSlotSecs = 300; // default 5 mins
    if (rotationFrequency === 'half_only') {
      targetSlotSecs = periodDurationSec;
    } else if (rotationFrequency !== 'auto') {
      targetSlotSecs = Math.round(parseFloat(rotationFrequency) * 60);
    } else {
      // Auto heuristic based on period length and squad size
      if (periodDurationSec <= 600) {
        // <= 10m halves: rotate once per half or at half
        targetSlotSecs = squadPlayerIds.length > effectivePlayersOnPitch ? 300 : periodDurationSec;
      } else if (periodDurationSec <= 900) {
        // 15m halves: 5m or 7.5m
        targetSlotSecs = squadPlayerIds.length > effectivePlayersOnPitch ? 300 : 450;
      } else if (periodDurationSec <= 1500) {
        // 20-25m halves: 5m or 6m or 7m
        targetSlotSecs = squadPlayerIds.length > effectivePlayersOnPitch ? 360 : 600;
      } else {
        // 30m+ halves: 8-10m
        targetSlotSecs = 600;
      }
    }

    for (let p = 1; p <= m.targetPeriods; p++) {
      const periodStartSec = (p - 1) * periodDurationSec;
      const numSlotsInPeriod = Math.max(1, Math.round(periodDurationSec / targetSlotSecs));
      const actualSlotSec = periodDurationSec / numSlotsInPeriod;

      for (let s = 0; s < numSlotsInPeriod; s++) {
        const slotStart = periodStartSec + Math.round(s * actualSlotSec);
        const slotEnd = periodStartSec + Math.round((s + 1) * actualSlotSec);
        const dur = slotEnd - slotStart;

        allSlots.push({
          matchIdx: mIdx,
          period: p,
          startSecond: slotStart,
          endSecond: slotEnd,
          durationSeconds: dur,
          globalStartSecond: currentGlobalOffset + slotStart
        });
      }
    }

    currentGlobalOffset += matchDurationsSeconds[mIdx];
  });

  // 3. Simulation & Lineup balancing across all slots
  const playedSeconds = new Map<string, number>();
  const gkSeconds = new Map<string, number>();
  const outfieldSeconds = new Map<string, number>();
  const benchSeconds = new Map<string, number>();
  const consecutiveRestSlots = new Map<string, number>();
  const consecutivePlaySlots = new Map<string, number>();
  const gkShiftsCount = new Map<string, number>();
  const outfieldShiftsCount = new Map<string, number>();

  squadPlayerIds.forEach((id) => {
    playedSeconds.set(id, 0);
    gkSeconds.set(id, 0);
    outfieldSeconds.set(id, 0);
    benchSeconds.set(id, 0);
    consecutiveRestSlots.set(id, 0);
    consecutivePlaySlots.set(id, 0);
    gkShiftsCount.set(id, 0);
    outfieldShiftsCount.set(id, 0);
  });

  const slotResults: SlotLineup[] = [];

  allSlots.forEach((slot) => {
    // Determine GK for this slot
    let slotGK = '';
    if (effectiveGkList.length > 0) {
      // Map global midpoint to GK shift
      const midGlobal = slot.globalStartSecond + slot.durationSeconds / 2;
      const fraction = Math.min(0.999999, Math.max(0, midGlobal / Math.max(1, totalMatchdaySeconds)));
      const gkIdx = Math.floor(fraction * effectiveGkList.length);
      slotGK = effectiveGkList[gkIdx];
    } else {
      // Fallback: first squad player
      slotGK = squadPlayerIds[0];
    }

    // GK stats update
    playedSeconds.set(slotGK, (playedSeconds.get(slotGK) || 0) + slot.durationSeconds);
    gkSeconds.set(slotGK, (gkSeconds.get(slotGK) || 0) + slot.durationSeconds);
    consecutivePlaySlots.set(slotGK, (consecutivePlaySlots.get(slotGK) || 0) + 1);
    consecutiveRestSlots.set(slotGK, 0);
    gkShiftsCount.set(slotGK, (gkShiftsCount.get(slotGK) || 0) + 1);

    // Candidates for outfield spots: all squad members except this slot's GK
    const outfieldCandidates = squadPlayerIds.filter((id) => id !== slotGK);

    // Sort outfield candidates by who needs minutes most, with rest bonus
    outfieldCandidates.sort((a, b) => {
      const playedA = playedSeconds.get(a) || 0;
      const playedB = playedSeconds.get(b) || 0;

      const restA = consecutiveRestSlots.get(a) || 0;
      const restB = consecutiveRestSlots.get(b) || 0;

      // Higher deficit = higher priority
      // Add strong weight to rest so bench players aren't benchwarmers
      const scoreA = (targetPlayingSecondsPerPlayer - playedA) + restA * 90;
      const scoreB = (targetPlayingSecondsPerPlayer - playedB) + restB * 90;

      if (scoreA !== scoreB) {
        return scoreB - scoreA; // descending
      }

      // Tiebreaker: total played ascending
      return playedA - playedB;
    });

    const chosenOutfield = outfieldCandidates.slice(0, targetOutfieldCount);
    const chosenBench = outfieldCandidates.slice(targetOutfieldCount);

    // Outfield players stats update
    chosenOutfield.forEach((id) => {
      playedSeconds.set(id, (playedSeconds.get(id) || 0) + slot.durationSeconds);
      outfieldSeconds.set(id, (outfieldSeconds.get(id) || 0) + slot.durationSeconds);
      consecutivePlaySlots.set(id, (consecutivePlaySlots.get(id) || 0) + 1);
      consecutiveRestSlots.set(id, 0);
      outfieldShiftsCount.set(id, (outfieldShiftsCount.get(id) || 0) + 1);
    });

    // Bench players stats update
    chosenBench.forEach((id) => {
      benchSeconds.set(id, (benchSeconds.get(id) || 0) + slot.durationSeconds);
      consecutiveRestSlots.set(id, (consecutiveRestSlots.get(id) || 0) + 1);
      consecutivePlaySlots.set(id, 0);
    });

    slotResults.push({
      matchIndex: slot.matchIdx + 1,
      period: slot.period,
      startSecond: slot.startSecond,
      endSecond: slot.endSecond,
      durationSeconds: slot.durationSeconds,
      gkPlayerId: slotGK,
      outfieldPlayerIds: chosenOutfield,
      benchPlayerIds: chosenBench
    });
  });

  // 4. Construct PlannedMatchOutput with substitutions
  const matchOutputs: PlannedMatchOutput[] = matches.map((m, mIdx) => {
    const matchSlots = slotResults.filter((s) => s.matchIndex === mIdx + 1);
    const firstSlot = matchSlots[0];

    const startingGK = firstSlot?.gkPlayerId;
    const startingOutfield = firstSlot?.outfieldPlayerIds || [];
    const startingBench = firstSlot?.benchPlayerIds || [];

    const plannedSubs: PlannedSubstitution[] = [];

    for (let i = 1; i < matchSlots.length; i++) {
      const prevSlot = matchSlots[i - 1];
      const curSlot = matchSlots[i];

      const gkChanged = prevSlot.gkPlayerId !== curSlot.gkPlayerId;

      // Identify outfielders leaving pitch to bench
      const outfieldersLeaving = prevSlot.outfieldPlayerIds.filter(
        (id) => !curSlot.outfieldPlayerIds.includes(id) && id !== curSlot.gkPlayerId
      );

      // Identify players entering outfield from bench
      const outfieldersEntering = curSlot.outfieldPlayerIds.filter(
        (id) => !prevSlot.outfieldPlayerIds.includes(id) && id !== prevSlot.gkPlayerId
      );

      const outfieldChanges: PlannedSubChange[] = [];
      const changeCount = Math.min(outfieldersLeaving.length, outfieldersEntering.length);

      for (let c = 0; c < changeCount; c++) {
        outfieldChanges.push({
          inPlayerId: outfieldersEntering[c],
          outPlayerId: outfieldersLeaving[c]
        });
      }

      // If lengths differ due to format or GK swap role change
      if (outfieldersEntering.length > changeCount) {
        for (let extra = changeCount; extra < outfieldersEntering.length; extra++) {
          outfieldChanges.push({
            inPlayerId: outfieldersEntering[extra],
            outPlayerId: prevSlot.gkPlayerId // GK swapped to outfield
          });
        }
      }

      if (gkChanged || outfieldChanges.length > 0) {
        plannedSubs.push({
          id: generateUUID(),
          period: curSlot.period,
          timestampSeconds: curSlot.startSecond,
          label: formatMMSS(curSlot.startSecond),
          gkChange: gkChanged
            ? {
                inPlayerId: curSlot.gkPlayerId,
                outPlayerId: prevSlot.gkPlayerId
              }
            : undefined,
          outfieldChanges,
          applied: false,
          dismissed: false,
          targetGoalkeeperId: curSlot.gkPlayerId,
          targetOutfieldPlayerIds: [...curSlot.outfieldPlayerIds],
          targetBenchPlayerIds: [...curSlot.benchPlayerIds]
        });
      }
    }

    return {
      matchIndex: mIdx + 1,
      opposition: m.opposition,
      format: m.format,
      targetPeriods: m.targetPeriods,
      periodDurationMinutes: m.periodDurationMinutes,
      totalDurationSeconds: matchDurationsSeconds[mIdx],
      startingGoalkeeperId: startingGK,
      startingOutfieldPlayerIds: startingOutfield,
      benchPlayerIds: startingBench,
      plannedSubstitutions: plannedSubs,
      slots: matchSlots
    };
  });

  // 5. Calculate player summaries & fairness
  const playerSummaries: PlayerRotationSummary[] = squadPlayerIds.map((id) => ({
    playerId: id,
    gkSeconds: gkSeconds.get(id) || 0,
    outfieldSeconds: outfieldSeconds.get(id) || 0,
    totalPlayingSeconds: playedSeconds.get(id) || 0,
    benchSeconds: benchSeconds.get(id) || 0,
    gkShiftsCount: gkShiftsCount.get(id) || 0,
    outfieldShiftsCount: outfieldShiftsCount.get(id) || 0
  }));

  const allPlayedSeconds = playerSummaries.map((p) => p.totalPlayingSeconds);
  const minPlayed = Math.min(...allPlayedSeconds);
  const maxPlayed = Math.max(...allPlayedSeconds);
  const maxDisparitySeconds = maxPlayed - minPlayed;

  return {
    matches: matchOutputs,
    playerSummaries,
    targetPlayingSecondsPerPlayer,
    targetGkSecondsPerGoalkeeper,
    maxDisparitySeconds,
    totalMatchdaySeconds,
    isFullyBalanced: maxDisparitySeconds <= 300 // within 5 minutes across entire day
  };
}
