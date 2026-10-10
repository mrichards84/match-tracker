import type { MatchFormat, PlannedSubstitution, PlannedSubChange } from '@/db/schema';

const formatMMSS = (totalSecs: number): string => {
  const mins = Math.floor(totalSecs / 60);
  const secs = Math.floor(totalSecs % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const generateUUID = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15);

export interface MatchSetupConfig {
  id?: string;
  matchIndex: number; // 1-based (Match 1, Match 2, ...)
  opposition: string;
  format: MatchFormat;
  targetPeriods: number; // e.g. 1, 2, 4
  periodDurationMinutes: number; // e.g. 15, 20, 25
  startingGoalkeeperId?: string; // Optional user-chosen starting goalkeeper
}

export type RotationFrequencySetting =
  | 'predictable_lengths'
  | 'minimum_interruptions'
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
  gkPlayerIds?: string[]; // Kept optional for backward compatibility
  playersOnPitch: number; // e.g. 7 for 7v7
  matches: MatchSetupConfig[];
  rotationFrequency?: RotationFrequencySetting;
}

export interface SlotLineup {
  matchIndex: number;
  period: number;
  startSecond: number;
  endSecond: number;
  durationSeconds: number;
  pitchPlayerIds: string[];
  benchPlayerIds: string[];
  gkPlayerId?: string;
}

export interface PlayerRotationSummary {
  playerId: string;
  totalPlayingSeconds: number;
  benchSeconds: number;
  shiftsCount: number;
  gkSeconds?: number;
  outfieldSeconds?: number;
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
  strategyMode: 'predictable_lengths' | 'minimum_interruptions' | 'fixed';
}

/**
 * Calculates equal playing time substitutions across 1 or more matches.
 * Focuses purely on pitch vs bench rotations, ensuring fair playing time for all players.
 */
export function calculateRotationPlan(input: RotationPlannerInput): RotationPlanResult {
  const { squadPlayerIds, playersOnPitch, matches, rotationFrequency = 'predictable_lengths' } = input;

  const mode = rotationFrequency === 'auto' ? 'predictable_lengths' : rotationFrequency;
  const isFixedInterval = !['predictable_lengths', 'minimum_interruptions'].includes(mode);
  const strategyMode: 'predictable_lengths' | 'minimum_interruptions' | 'fixed' =
    mode === 'minimum_interruptions'
      ? 'minimum_interruptions'
      : isFixedInterval
      ? 'fixed'
      : 'predictable_lengths';

  if (squadPlayerIds.length === 0 || matches.length === 0) {
    return {
      matches: [],
      playerSummaries: [],
      targetPlayingSecondsPerPlayer: 0,
      targetGkSecondsPerGoalkeeper: 0,
      maxDisparitySeconds: 0,
      totalMatchdaySeconds: 0,
      isFullyBalanced: true,
      strategyMode
    };
  }

  const effectivePlayersOnPitch = Math.min(playersOnPitch, squadPlayerIds.length);
  const benchCount = Math.max(0, squadPlayerIds.length - effectivePlayersOnPitch);

  // 1. Calculate durations & targets across the matchday
  const matchDurationsSeconds = matches.map(
    (m) => m.targetPeriods * m.periodDurationMinutes * 60
  );
  const totalMatchdaySeconds = matchDurationsSeconds.reduce((sum, d) => sum + d, 0);

  const totalPitchPlayerSeconds = totalMatchdaySeconds * effectivePlayersOnPitch;
  const targetPlayingSecondsPerPlayer = Math.round(
    totalPitchPlayerSeconds / squadPlayerIds.length
  );
  const targetBenchSecondsPerPlayer = totalMatchdaySeconds - targetPlayingSecondsPerPlayer;

  // 2. Generate raw stoppage timestamps across all matches
  interface MatchIntervalDef {
    matchIdx: number;
    matchGlobalStart: number;
    matchDuration: number;
    periodDuration: number;
    periods: number;
    startingGoalkeeperId?: string;
  }

  const matchDefs: MatchIntervalDef[] = [];
  let gOffset = 0;
  matches.forEach((m, idx) => {
    const mDur = matchDurationsSeconds[idx];
    const pDur = m.periodDurationMinutes * 60;
    matchDefs.push({
      matchIdx: idx,
      matchGlobalStart: gOffset,
      matchDuration: mDur,
      periodDuration: pDur,
      periods: m.targetPeriods,
      startingGoalkeeperId: m.startingGoalkeeperId
    });
    gOffset += mDur;
  });

  const rawGlobalTimestamps: number[] = [0, totalMatchdaySeconds];

  // Add match boundaries & period boundaries
  matchDefs.forEach((mDef) => {
    rawGlobalTimestamps.push(mDef.matchGlobalStart);
    for (let p = 1; p < mDef.periods; p++) {
      rawGlobalTimestamps.push(mDef.matchGlobalStart + p * mDef.periodDuration);
    }
    rawGlobalTimestamps.push(mDef.matchGlobalStart + mDef.matchDuration);
  });

  // Add strategy-specific substitution points
  if (benchCount > 0) {
    matchDefs.forEach((mDef) => {
      const matchSeconds = mDef.matchDuration;
      if (mode === 'minimum_interruptions') {
        // Bunched substitutions: minimize stoppages.
        const minSlotsNeeded = Math.max(2, Math.ceil(squadPlayerIds.length / benchCount));
        const step = matchSeconds / minSlotsNeeded;
        for (let s = 1; s < minSlotsNeeded; s++) {
          rawGlobalTimestamps.push(mDef.matchGlobalStart + Math.round(s * step));
        }
      } else if (mode === 'predictable_lengths') {
        // Predictable lengths: rotate regularly with minimum players changed per stoppage (1 or 2 players).
        const targetSlots = Math.max(4, squadPlayerIds.length);
        const step = matchSeconds / targetSlots;
        for (let s = 1; s < targetSlots; s++) {
          rawGlobalTimestamps.push(mDef.matchGlobalStart + Math.round(s * step));
        }
      } else if (mode === 'half_only') {
        // Already captured period boundaries
      } else {
        // Fixed interval in minutes
        const intSec = Math.round(parseFloat(mode) * 60);
        for (let t = intSec; t < matchSeconds; t += intSec) {
          rawGlobalTimestamps.push(mDef.matchGlobalStart + t);
        }
      }
    });
  }

  // Snap nearby timestamps (< 90s)
  const sortedGlobal = Array.from(new Set(rawGlobalTimestamps))
    .sort((a, b) => a - b)
    .filter((t) => t >= 0 && t <= totalMatchdaySeconds);

  const snappedGlobal: number[] = [];
  for (let i = 0; i < sortedGlobal.length; i++) {
    const cur = sortedGlobal[i];
    if (snappedGlobal.length === 0) {
      snappedGlobal.push(cur);
    } else {
      const prev = snappedGlobal[snappedGlobal.length - 1];
      const isMatchBoundary = matchDefs.some((m) => m.matchGlobalStart === cur);
      if (!isMatchBoundary && cur - prev < 90 && cur < totalMatchdaySeconds) {
        if (cur % 300 === 0) {
          snappedGlobal[snappedGlobal.length - 1] = cur;
        } else if (prev % 300 !== 0) {
          snappedGlobal[snappedGlobal.length - 1] = Math.round((prev + cur) / 2);
        }
      } else {
        snappedGlobal.push(cur);
      }
    }
  }

  // 3. Construct Slices across matches
  interface GlobalSlice {
    sliceIndex: number;
    matchIdx: number;
    period: number;
    startSecond: number;
    endSecond: number;
    durationSeconds: number;
    globalStartSecond: number;
    globalEndSecond: number;
    matchDef: MatchIntervalDef;
  }

  const slices: GlobalSlice[] = [];
  let prevGlobal = 0;

  for (const tGlobal of snappedGlobal) {
    if (tGlobal > prevGlobal) {
      const dur = tGlobal - prevGlobal;
      const midGlobal = (prevGlobal + tGlobal) / 2;

      const mDef =
        matchDefs.find(
          (m) => midGlobal >= m.matchGlobalStart && midGlobal < m.matchGlobalStart + m.matchDuration
        ) || matchDefs[matchDefs.length - 1];

      const localStart = prevGlobal - mDef.matchGlobalStart;
      const localEnd = tGlobal - mDef.matchGlobalStart;
      const period = Math.min(
        mDef.periods,
        Math.floor(localStart / mDef.periodDuration) + 1
      );

      slices.push({
        sliceIndex: slices.length,
        matchIdx: mDef.matchIdx,
        period,
        startSecond: localStart,
        endSecond: localEnd,
        durationSeconds: dur,
        globalStartSecond: prevGlobal,
        globalEndSecond: tGlobal,
        matchDef: mDef
      });

      prevGlobal = tGlobal;
    }
  }

  // 4. Lineup assignment balancing pitch vs bench time
  const playedSeconds = new Map<string, number>();
  const benchSeconds = new Map<string, number>();
  const consecutiveBenchCount = new Map<string, number>();

  squadPlayerIds.forEach((id) => {
    playedSeconds.set(id, 0);
    benchSeconds.set(id, 0);
    consecutiveBenchCount.set(id, 0);
  });

  interface SliceLineup {
    pitch: string[];
    bench: string[];
  }
  const sliceLineups: SliceLineup[] = [];

  slices.forEach((slice) => {
    const candidates = [...squadPlayerIds];
    const isFirstSliceOfMatch = slice.startSecond === 0;
    const designatedGk = slice.matchDef.startingGoalkeeperId;

    candidates.sort((a, b) => {
      // If a starting GK is designated for this match, guarantee they start on the pitch in kickoff slot
      if (isFirstSliceOfMatch && designatedGk) {
        if (a === designatedGk) return 1;
        if (b === designatedGk) return -1;
      }

      const benchDeficitA = targetBenchSecondsPerPlayer - (benchSeconds.get(a) || 0);
      const benchDeficitB = targetBenchSecondsPerPlayer - (benchSeconds.get(b) || 0);

      const remMatchday = totalMatchdaySeconds - slice.globalStartSecond;
      const urgA = remMatchday > 0 ? benchDeficitA / remMatchday : 0;
      const urgB = remMatchday > 0 ? benchDeficitB / remMatchday : 0;

      if (Math.abs(urgA - urgB) > 0.05) {
        return urgB - urgA;
      }

      if (Math.abs(benchDeficitA - benchDeficitB) > 15) {
        return benchDeficitB - benchDeficitA;
      }

      const restA = consecutiveBenchCount.get(a) || 0;
      const restB = consecutiveBenchCount.get(b) || 0;
      if (restA > 0 && restB === 0) return 1;
      if (restB > 0 && restA === 0) return -1;

      return benchDeficitB - benchDeficitA;
    });

    const chosenBench = candidates.slice(0, benchCount);
    const chosenPitch = candidates.slice(benchCount);

    chosenPitch.forEach((id) => {
      playedSeconds.set(id, (playedSeconds.get(id) || 0) + slice.durationSeconds);
      consecutiveBenchCount.set(id, 0);
    });

    chosenBench.forEach((id) => {
      benchSeconds.set(id, (benchSeconds.get(id) || 0) + slice.durationSeconds);
      consecutiveBenchCount.set(id, (consecutiveBenchCount.get(id) || 0) + 1);
    });

    sliceLineups.push({
      pitch: chosenPitch,
      bench: chosenBench
    });
  });

  // 5. Local 2-opt swap pass to eliminate residual disparity
  const calcTotals = () => {
    const map = new Map<string, number>();
    squadPlayerIds.forEach((id) => map.set(id, 0));
    sliceLineups.forEach((l, idx) => {
      const dur = slices[idx].durationSeconds;
      l.pitch.forEach((id) => map.set(id, (map.get(id) || 0) + dur));
    });
    return map;
  };

  let currentTotals = calcTotals();
  for (let iter = 0; iter < 40; iter++) {
    const sorted = [...squadPlayerIds].sort(
      (a, b) => (currentTotals.get(b) || 0) - (currentTotals.get(a) || 0)
    );
    const mostPlayed = sorted[0];
    const leastPlayed = sorted[sorted.length - 1];
    const disp = (currentTotals.get(mostPlayed) || 0) - (currentTotals.get(leastPlayed) || 0);

    if (disp <= 60) break;

    let swapped = false;
    for (let s = 0; s < sliceLineups.length; s++) {
      const l = sliceLineups[s];
      const dur = slices[s].durationSeconds;
      if (dur > disp) continue;

      const sl = slices[s];
      const isKickoff = sl.startSecond === 0;
      const designatedGk = sl.matchDef.startingGoalkeeperId;

      for (let i = 0; i < sorted.length; i++) {
        const pHigh = sorted[i];
        if (!l.pitch.includes(pHigh)) continue;
        if (isKickoff && pHigh === designatedGk) continue;

        for (let j = sorted.length - 1; j > i; j--) {
          const pLow = sorted[j];
          if (!l.bench.includes(pLow)) continue;

          const diff = (currentTotals.get(pHigh) || 0) - (currentTotals.get(pLow) || 0);
          if (diff >= dur * 1.5) {
            l.pitch = l.pitch.map((id) => (id === pHigh ? pLow : id));
            l.bench = l.bench.map((id) => (id === pLow ? pHigh : id));
            currentTotals = calcTotals();
            swapped = true;
            break;
          }
        }
        if (swapped) break;
      }
      if (swapped) break;
    }
    if (!swapped) break;
  }

  // 6. Recalculate definitive stats
  const finalPlayed = new Map<string, number>();
  const finalBench = new Map<string, number>();
  const finalShifts = new Map<string, number>();

  squadPlayerIds.forEach((id) => {
    finalPlayed.set(id, 0);
    finalBench.set(id, 0);
    finalShifts.set(id, 0);
  });

  const slotResults: SlotLineup[] = [];

  sliceLineups.forEach((lineup, idx) => {
    const sl = slices[idx];
    const dur = sl.durationSeconds;

    lineup.pitch.forEach((id) => {
      finalPlayed.set(id, (finalPlayed.get(id) || 0) + dur);
      finalShifts.set(id, (finalShifts.get(id) || 0) + 1);
    });

    lineup.bench.forEach((id) => {
      finalBench.set(id, (finalBench.get(id) || 0) + dur);
    });

    slotResults.push({
      matchIndex: sl.matchIdx + 1,
      period: sl.period,
      startSecond: sl.startSecond,
      endSecond: sl.endSecond,
      durationSeconds: dur,
      pitchPlayerIds: lineup.pitch,
      benchPlayerIds: lineup.bench,
      gkPlayerId: sl.matchDef.startingGoalkeeperId || lineup.pitch[0]
    });
  });

  // 7. Construct PlannedMatchOutput with substitutions
  const matchOutputs: PlannedMatchOutput[] = matches.map((m, mIdx) => {
    const matchSlots = slotResults.filter((s) => s.matchIndex === mIdx + 1);
    const firstSlot = matchSlots[0];

    const startingPitch = firstSlot?.pitchPlayerIds || [];
    const startingBench = firstSlot?.benchPlayerIds || [];

    // Designated starting GK (or first player in starting pitch)
    const startingGK = m.startingGoalkeeperId && startingPitch.includes(m.startingGoalkeeperId)
      ? m.startingGoalkeeperId
      : startingPitch[0];

    const startingOutfield = startingPitch.filter((id) => id !== startingGK);

    const plannedSubs: PlannedSubstitution[] = [];

    for (let i = 1; i < matchSlots.length; i++) {
      const prevSlot = matchSlots[i - 1];
      const curSlot = matchSlots[i];

      const leavingPitch = prevSlot.pitchPlayerIds.filter(
        (id) => !curSlot.pitchPlayerIds.includes(id)
      );
      const enteringPitch = curSlot.pitchPlayerIds.filter(
        (id) => !prevSlot.pitchPlayerIds.includes(id)
      );

      const outfieldChanges: PlannedSubChange[] = [];
      const changeCount = Math.min(leavingPitch.length, enteringPitch.length);

      for (let c = 0; c < changeCount; c++) {
        outfieldChanges.push({
          inPlayerId: enteringPitch[c],
          outPlayerId: leavingPitch[c]
        });
      }

      if (outfieldChanges.length > 0) {
        // Current GK remains startingGK unless they were substituted off, in which case first remaining pitch player takes goal
        const currentGK = curSlot.pitchPlayerIds.includes(startingGK)
          ? startingGK
          : curSlot.pitchPlayerIds[0];

        plannedSubs.push({
          id: generateUUID(),
          period: curSlot.period,
          timestampSeconds: curSlot.startSecond,
          label: formatMMSS(curSlot.startSecond),
          outfieldChanges,
          applied: false,
          dismissed: false,
          targetGoalkeeperId: currentGK,
          targetOutfieldPlayerIds: curSlot.pitchPlayerIds.filter((id) => id !== currentGK),
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

  // 8. Player summaries & fairness assessment
  const playerSummaries: PlayerRotationSummary[] = squadPlayerIds.map((id) => ({
    playerId: id,
    totalPlayingSeconds: finalPlayed.get(id) || 0,
    benchSeconds: finalBench.get(id) || 0,
    shiftsCount: finalShifts.get(id) || 0,
    gkSeconds: 0,
    outfieldSeconds: finalPlayed.get(id) || 0
  }));

  const allPlayedSeconds = playerSummaries.map((p) => p.totalPlayingSeconds);
  const minPlayed = Math.min(...allPlayedSeconds);
  const maxPlayed = Math.max(...allPlayedSeconds);
  const maxDisparitySeconds = maxPlayed - minPlayed;

  return {
    matches: matchOutputs,
    playerSummaries,
    targetPlayingSecondsPerPlayer,
    targetGkSecondsPerGoalkeeper: 0,
    maxDisparitySeconds,
    totalMatchdaySeconds,
    isFullyBalanced: maxDisparitySeconds <= 120,
    strategyMode
  };
}
