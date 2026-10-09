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
  strategyMode: 'predictable_lengths' | 'minimum_interruptions' | 'fixed';
}

/**
 * Calculates equal playing time rotations and goalkeeper duties across 1 or more matches.
 * Uses a GK-aware urgency algorithm and 2-opt balance pass to eliminate goalkeeper minutes bias.
 */
export function calculateRotationPlan(input: RotationPlannerInput): RotationPlanResult {
  const { squadPlayerIds, gkPlayerIds, playersOnPitch, matches, rotationFrequency = 'predictable_lengths' } = input;

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
  const targetOutfieldCount = Math.max(0, effectivePlayersOnPitch - 1);
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

  const effectiveGkList = gkPlayerIds.filter((id) => squadPlayerIds.includes(id));
  const effectiveGkCount = effectiveGkList.length;
  const targetGkSecondsPerGoalkeeper =
    effectiveGkCount > 0
      ? Math.round(totalMatchdaySeconds / effectiveGkCount)
      : 0;

  // 2. Global Goalkeeper Shifts (exact equal chunks across the matchday)
  interface GlobalGkShift {
    playerId: string;
    startGlobal: number;
    endGlobal: number;
  }
  const gkShifts: GlobalGkShift[] = [];
  if (effectiveGkCount > 0) {
    const shiftDur = totalMatchdaySeconds / effectiveGkCount;
    for (let g = 0; g < effectiveGkCount; g++) {
      gkShifts.push({
        playerId: effectiveGkList[g],
        startGlobal: Math.round(g * shiftDur),
        endGlobal: Math.round((g + 1) * shiftDur)
      });
    }
  }

  // 3. Generate raw stoppage timestamps across all matches
  interface MatchIntervalDef {
    matchIdx: number;
    matchGlobalStart: number;
    matchDuration: number;
    periodDuration: number;
    periods: number;
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
      periods: m.targetPeriods
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

  // Add GK shift change boundaries
  gkShifts.forEach((s) => {
    if (s.startGlobal > 0 && s.startGlobal < totalMatchdaySeconds) {
      rawGlobalTimestamps.push(s.startGlobal);
    }
  });

  // Add strategy-specific substitution points
  if (benchCount > 0) {
    matchDefs.forEach((mDef) => {
      const matchSeconds = mDef.matchDuration;
      if (mode === 'minimum_interruptions') {
        // Bunched substitutions: minimize stoppages.
        // If match has no internal GK change or period breaks, add minimum needed stoppage.
        const minSlotsNeeded = Math.max(2, Math.ceil(squadPlayerIds.length / Math.max(1, benchCount)));
        const step = matchSeconds / minSlotsNeeded;
        for (let s = 1; s < minSlotsNeeded; s++) {
          rawGlobalTimestamps.push(mDef.matchGlobalStart + Math.round(s * step));
        }
      } else if (mode === 'predictable_lengths') {
        // Predictable lengths: rotate regularly with minimum players changed per stoppage (1 or 2 players).
        // Target squadPlayerIds.length slots across the match gives clean 1-shift rotation.
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

  // Snap nearby timestamps (within 120 seconds of each other) to prevent awkward 1-minute stints
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
      // Don't merge across match boundaries
      const isMatchBoundary = matchDefs.some((m) => m.matchGlobalStart === cur);
      if (!isMatchBoundary && cur - prev < 120 && cur < totalMatchdaySeconds) {
        // Snap to closest 5-minute mark or average
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

  // 4. Construct Slices across matches
  interface GlobalSlice {
    sliceIndex: number;
    matchIdx: number;
    period: number;
    startSecond: number; // match-local start
    endSecond: number; // match-local end
    durationSeconds: number;
    globalStartSecond: number;
    globalEndSecond: number;
    gkPlayerId: string;
  }

  const slices: GlobalSlice[] = [];
  let prevGlobal = 0;

  for (const tGlobal of snappedGlobal) {
    if (tGlobal > prevGlobal) {
      const dur = tGlobal - prevGlobal;
      const midGlobal = (prevGlobal + tGlobal) / 2;

      // Find which match this slice belongs to
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

      // Determine GK for this slice
      const currentGk =
        gkShifts.find((s) => midGlobal >= s.startGlobal && midGlobal < s.endGlobal)?.playerId ||
        effectiveGkList[0] ||
        squadPlayerIds[0];

      slices.push({
        sliceIndex: slices.length,
        matchIdx: mDef.matchIdx,
        period,
        startSecond: localStart,
        endSecond: localEnd,
        durationSeconds: dur,
        globalStartSecond: prevGlobal,
        globalEndSecond: tGlobal,
        gkPlayerId: currentGk
      });

      prevGlobal = tGlobal;
    }
  }

  // 5. Lineup assignment using GK-Aware Bench Urgency
  const playedSeconds = new Map<string, number>();
  const gkSeconds = new Map<string, number>();
  const outfieldSeconds = new Map<string, number>();
  const benchSeconds = new Map<string, number>();
  const consecutiveBenchCount = new Map<string, number>();

  squadPlayerIds.forEach((id) => {
    playedSeconds.set(id, 0);
    gkSeconds.set(id, 0);
    outfieldSeconds.set(id, 0);
    benchSeconds.set(id, 0);
    consecutiveBenchCount.set(id, 0);
  });

  const getFutureGkTime = (playerId: string, fromGlobalSec: number) => {
    let s = 0;
    for (const sh of gkShifts) {
      if (sh.playerId === playerId && sh.endGlobal > fromGlobalSec) {
        s += sh.endGlobal - Math.max(fromGlobalSec, sh.startGlobal);
      }
    }
    return s;
  };

  interface SliceLineup {
    gk: string;
    outfield: string[];
    bench: string[];
  }
  const sliceLineups: SliceLineup[] = [];

  slices.forEach((slice) => {
    const slotGK = slice.gkPlayerId;
    playedSeconds.set(slotGK, (playedSeconds.get(slotGK) || 0) + slice.durationSeconds);
    gkSeconds.set(slotGK, (gkSeconds.get(slotGK) || 0) + slice.durationSeconds);
    consecutiveBenchCount.set(slotGK, 0);

    const candidates = squadPlayerIds.filter((id) => id !== slotGK);
    const neededBench = Math.max(0, candidates.length - targetOutfieldCount);

    // Sort outfield candidates by who needs to sit on bench most urgently
    candidates.sort((a, b) => {
      const benchDeficitA = targetBenchSecondsPerPlayer - (benchSeconds.get(a) || 0);
      const benchDeficitB = targetBenchSecondsPerPlayer - (benchSeconds.get(b) || 0);

      const remMatchday = totalMatchdaySeconds - slice.globalStartSecond;
      const futGkA = getFutureGkTime(a, slice.globalStartSecond);
      const futGkB = getFutureGkTime(b, slice.globalStartSecond);
      const availA = Math.max(0, remMatchday - futGkA);
      const availB = Math.max(0, remMatchday - futGkB);

      const urgA = availA > 0 ? benchDeficitA / availA : benchDeficitA > 0 ? 10 : -10;
      const urgB = availB > 0 ? benchDeficitB / availB : benchDeficitB > 0 ? 10 : -10;

      // Primary: urgency difference
      if (Math.abs(urgA - urgB) > 0.08) {
        return urgB - urgA;
      }

      // Secondary: bench deficit in seconds
      if (Math.abs(benchDeficitA - benchDeficitB) > 20) {
        return benchDeficitB - benchDeficitA;
      }

      // Rest bonus: avoid benching the same player multiple consecutive slots if others can rotate
      const restA = consecutiveBenchCount.get(a) || 0;
      const restB = consecutiveBenchCount.get(b) || 0;
      if (restA > 0 && restB === 0) return 1;
      if (restB > 0 && restA === 0) return -1;

      return benchDeficitB - benchDeficitA;
    });

    const chosenBench = candidates.slice(0, neededBench);
    const chosenOutfield = candidates.slice(neededBench);

    chosenOutfield.forEach((id) => {
      playedSeconds.set(id, (playedSeconds.get(id) || 0) + slice.durationSeconds);
      outfieldSeconds.set(id, (outfieldSeconds.get(id) || 0) + slice.durationSeconds);
      consecutiveBenchCount.set(id, 0);
    });

    chosenBench.forEach((id) => {
      benchSeconds.set(id, (benchSeconds.get(id) || 0) + slice.durationSeconds);
      consecutiveBenchCount.set(id, (consecutiveBenchCount.get(id) || 0) + 1);
    });

    sliceLineups.push({
      gk: slotGK,
      outfield: chosenOutfield,
      bench: chosenBench
    });
  });

  // 6. Local 2-opt swap pass to eliminate residual disparity
  const calcTotals = () => {
    const map = new Map<string, number>();
    squadPlayerIds.forEach((id) => map.set(id, 0));
    sliceLineups.forEach((l, idx) => {
      const dur = slices[idx].durationSeconds;
      map.set(l.gk, (map.get(l.gk) || 0) + dur);
      l.outfield.forEach((id) => map.set(id, (map.get(id) || 0) + dur));
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

    if (disp <= 60) break; // within 1 minute across the matchday is fully balanced

    let swapped = false;
    for (let s = 0; s < sliceLineups.length; s++) {
      const l = sliceLineups[s];
      const dur = slices[s].durationSeconds;
      if (dur > disp) continue; // swapping here would overshoot

      for (let i = 0; i < sorted.length; i++) {
        const pHigh = sorted[i];
        if (!l.outfield.includes(pHigh)) continue;

        for (let j = sorted.length - 1; j > i; j--) {
          const pLow = sorted[j];
          if (!l.bench.includes(pLow)) continue;

          const diff = (currentTotals.get(pHigh) || 0) - (currentTotals.get(pLow) || 0);
          if (diff >= dur * 1.5) {
            l.outfield = l.outfield.map((id) => (id === pHigh ? pLow : id));
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

  // 7. Recalculate definitive stats from final lineup
  const finalPlayed = new Map<string, number>();
  const finalGk = new Map<string, number>();
  const finalOutfield = new Map<string, number>();
  const finalBench = new Map<string, number>();
  const finalGkShifts = new Map<string, number>();
  const finalOutfieldShifts = new Map<string, number>();

  squadPlayerIds.forEach((id) => {
    finalPlayed.set(id, 0);
    finalGk.set(id, 0);
    finalOutfield.set(id, 0);
    finalBench.set(id, 0);
    finalGkShifts.set(id, 0);
    finalOutfieldShifts.set(id, 0);
  });

  const slotResults: SlotLineup[] = [];

  sliceLineups.forEach((lineup, idx) => {
    const sl = slices[idx];
    const dur = sl.durationSeconds;

    finalPlayed.set(lineup.gk, (finalPlayed.get(lineup.gk) || 0) + dur);
    finalGk.set(lineup.gk, (finalGk.get(lineup.gk) || 0) + dur);
    finalGkShifts.set(lineup.gk, (finalGkShifts.get(lineup.gk) || 0) + 1);

    lineup.outfield.forEach((id) => {
      finalPlayed.set(id, (finalPlayed.get(id) || 0) + dur);
      finalOutfield.set(id, (finalOutfield.get(id) || 0) + dur);
      finalOutfieldShifts.set(id, (finalOutfieldShifts.get(id) || 0) + 1);
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
      gkPlayerId: lineup.gk,
      outfieldPlayerIds: lineup.outfield,
      benchPlayerIds: lineup.bench
    });
  });

  // 8. Construct PlannedMatchOutput with substitutions
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

      // If lengths differ due to GK swap role change
      if (outfieldersEntering.length > changeCount) {
        for (let extra = changeCount; extra < outfieldersEntering.length; extra++) {
          outfieldChanges.push({
            inPlayerId: outfieldersEntering[extra],
            outPlayerId: prevSlot.gkPlayerId // departing GK moved to outfield
          });
        }
      } else if (outfieldersLeaving.length > changeCount) {
        for (let extra = changeCount; extra < outfieldersLeaving.length; extra++) {
          outfieldChanges.push({
            inPlayerId: curSlot.gkPlayerId, // entering GK came from outfield
            outPlayerId: outfieldersLeaving[extra]
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

  // 9. Player summaries & fairness assessment
  const playerSummaries: PlayerRotationSummary[] = squadPlayerIds.map((id) => ({
    playerId: id,
    gkSeconds: finalGk.get(id) || 0,
    outfieldSeconds: finalOutfield.get(id) || 0,
    totalPlayingSeconds: finalPlayed.get(id) || 0,
    benchSeconds: finalBench.get(id) || 0,
    gkShiftsCount: finalGkShifts.get(id) || 0,
    outfieldShiftsCount: finalOutfieldShifts.get(id) || 0
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
    // Fully balanced if disparity is within 2 minutes across the entire matchday
    isFullyBalanced: maxDisparitySeconds <= 120,
    strategyMode
  };
}
