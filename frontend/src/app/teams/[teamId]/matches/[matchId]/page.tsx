'use client';

import React, { useState, useEffect, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, generateUUID } from '@/db';
import type { Match, MatchEvent, PlayerMatchStint, PlannedSubstitution } from '@/db/schema';
import { Navbar } from '@/components/Navbar';
import { GoalkeeperIcon } from '@/components/GoalkeeperIcon';
import { sound, isSoundEnabled, setSoundEnabled } from '@/utils/audio';
import { hapticFeedback } from '@/utils/haptics';
import { wakeLock } from '@/utils/wakeLock';
import { formatMMSS, formatTimeShort } from '@/utils/formatters';
import {
  Play,
  Pause,
  RotateCcw,
  ArrowRightLeft,
  Shield,
  Plus,
  Zap,
  Check,
  X,
  Clock,
  History,
  Trash2,
  AlertTriangle,
  Users,
  ChevronRight,
  SunMedium,
  Star,
  UserPlus,
  Bell,
  Sparkles,
  ArrowRight,
  Volume2,
  VolumeX
} from 'lucide-react';

export default function LiveMatchPage({
  params
}: {
  params: Promise<{ teamId: string; matchId: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const teamId = resolvedParams.teamId;
  const matchId = resolvedParams.matchId;

  // Dexie live queries
  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const match = useLiveQuery(() => db.matches.get(matchId), [matchId]);
  const players = useLiveQuery(
    () => db.players.where('teamId').equals(teamId).toArray(),
    [teamId]
  );
  const nextMatch = useLiveQuery(
    () => (match?.nextMatchId ? db.matches.get(match.nextMatchId) : undefined),
    [match?.nextMatchId]
  );

  // Local tick counter to trigger re-renders every 1s while running
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const whistlePlayedForPeriodRef = useRef<number | null>(null);
  const alertedSubIdsRef = useRef<Set<string>>(new Set());
  const [soundActive, setSoundActive] = useState(false);

  useEffect(() => {
    setSoundActive(isSoundEnabled());
    const handleSoundChange = (e: any) => {
      setSoundActive(e.detail?.enabled ?? isSoundEnabled());
    };
    window.addEventListener('sound-setting-changed', handleSoundChange);
    return () => window.removeEventListener('sound-setting-changed', handleSoundChange);
  }, []);

  const handleToggleSound = () => {
    const next = !soundActive;
    setSoundActive(next);
    setSoundEnabled(next);
    hapticFeedback.tap();
  };

  // Modals
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showSubModal, setShowSubModal] = useState(false);
  const [selectedPitchPlayerForSub, setSelectedPitchPlayerForSub] = useState<string | null>(null);
  const [showBatchSubModal, setShowBatchSubModal] = useState(false);
  const [showGKSwapModal, setShowGKSwapModal] = useState(false);
  const [confirmGKSwapPlayerId, setConfirmGKSwapPlayerId] = useState<string | null>(null);
  const [benchSubTargetPlayerId, setBenchSubTargetPlayerId] = useState<string | null>(null);
  const [showPowerplayModal, setShowPowerplayModal] = useState(false);
  const [extraPlayerModalTab, setExtraPlayerModalTab] = useState<'add' | 'remove'>('add');
  const [showEventsModal, setShowEventsModal] = useState(false);
  const [showEndMatchModal, setShowEndMatchModal] = useState(false);
  const [showNextPeriodModal, setShowNextPeriodModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedPotmId, setSelectedPotmId] = useState<string | null>(null);

  // Batch sub state: pairs of { offId, onId }
  const [batchPairs, setBatchPairs] = useState<{ offId: string; onId: string }[]>([]);

  // Map players for fast lookup
  const playerMap = new Map((players || []).map((p) => [p.id, p]));

  // Calculate live current match seconds (drift-free)
  const isRunning = match?.status === 'in_progress';
  const elapsed = match?.elapsedSeconds || 0;
  const lastStarted = match?.lastStartedAt || 0;

  useEffect(() => {
    if (!match) return;

    const computeSeconds = () => {
      if (match.status === 'in_progress' && match.lastStartedAt) {
        const runningTime = Math.floor((Date.now() - match.lastStartedAt) / 1000);
        return match.elapsedSeconds + runningTime;
      }
      return match.elapsedSeconds;
    };

    setCurrentSeconds(computeSeconds());

    let intervalId: NodeJS.Timeout | null = null;
    if (match.status === 'in_progress') {
      wakeLock.request();
      intervalId = setInterval(() => {
        const secs = computeSeconds();
        setCurrentSeconds(secs);

        // Check if half duration reached and sound whistle if not sounded yet
        const halfTargetSecs = match.periodDurationMinutes * 60 * match.currentPeriod;
        if (secs >= halfTargetSecs && whistlePlayedForPeriodRef.current !== match.currentPeriod) {
          whistlePlayedForPeriodRef.current = match.currentPeriod;
          sound.playWhistle(0.5, 3);
          hapticFeedback.period();
        }

        // Check if a planned substitution has arrived
        if (match.plannedSubstitutions) {
          for (const pSub of match.plannedSubstitutions) {
            if (!pSub.applied && !pSub.dismissed && secs >= pSub.timestampSeconds) {
              if (!alertedSubIdsRef.current.has(pSub.id)) {
                alertedSubIdsRef.current.add(pSub.id);
                sound.playSubstitutionAlert();
                hapticFeedback.subAlert();
              }
            }
          }
        }
      }, 1000);
    } else {
      wakeLock.release();
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      wakeLock.release();
    };
  }, [match]);

  if (!match || !team) {
    return (
      <>
        <Navbar showBack backHref={`/teams/${teamId}`} title="Match Not Found" />
        <main className="main-content" style={{ textAlign: 'center', paddingTop: '40px' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading match data...</p>
        </main>
      </>
    );
  }

  // --- Clock Control Handlers ---
  const handleToggleTimer = async () => {
    hapticFeedback.tap();
    const now = Date.now();

    if (match.status === 'in_progress') {
      // Pause timer: calculate true elapsed seconds and persist
      const additional = match.lastStartedAt ? Math.floor((now - match.lastStartedAt) / 1000) : 0;
      const newElapsed = match.elapsedSeconds + additional;

      await db.matches.update(matchId, {
        status: 'paused',
        elapsedSeconds: newElapsed,
        lastStartedAt: undefined
      });
    } else {
      // Resume / Start timer (from paused or setup)
      const isFromSetup = match.status === 'setup';
      const updates: Partial<Match> = {
        status: 'in_progress',
        lastStartedAt: now
      };

      if (isFromSetup) {
        sound.playWhistle(0.5, 2);
        const hasKickOff = match.events.some((e) => e.type === 'period_start' && e.period === 1);
        if (!hasKickOff) {
          const kickOffEvent: MatchEvent = {
            id: generateUUID(),
            matchId,
            type: 'period_start',
            timestampSeconds: 0,
            period: 1,
            notes: 'Match kick-off',
            createdAt: now
          };
          updates.events = [...match.events, kickOffEvent];
        }
      }

      await db.matches.update(matchId, updates);
    }
  };

  const handleCancelSetup = async () => {
    if (!window.confirm('Cancel and delete this prepared matchday session?')) return;
    hapticFeedback.tap();
    if (match.matchGroupId) {
      await db.matches.where('matchGroupId').equals(match.matchGroupId).delete();
    } else {
      await db.matches.delete(matchId);
    }
    router.push(`/teams/${teamId}`);
  };

  // --- Goal Handlers ---
  const handleScoreHomeGoal = async (scorerId?: string) => {
    hapticFeedback.goal();
    const now = Date.now();
    const currentSecs = currentSeconds;

    const newEvent: MatchEvent = {
      id: generateUUID(),
      matchId,
      type: 'goal_for',
      timestampSeconds: currentSecs,
      period: match.currentPeriod,
      playerId: scorerId,
      createdAt: now
    };

    await db.matches.update(matchId, {
      scoreFor: match.scoreFor + 1,
      events: [...match.events, newEvent]
    });

    setShowGoalModal(false);
  };

  const handleScoreAwayGoal = async () => {
    hapticFeedback.warning();
    const now = Date.now();
    const currentSecs = currentSeconds;

    const newEvent: MatchEvent = {
      id: generateUUID(),
      matchId,
      type: 'goal_against',
      timestampSeconds: currentSecs,
      period: match.currentPeriod,
      createdAt: now
    };

    await db.matches.update(matchId, {
      scoreAgainst: match.scoreAgainst + 1,
      events: [...match.events, newEvent]
    });
  };

  // --- Substitution Handlers ---
  const handleExecute1to1Sub = async (playerOffId: string, playerOnId: string) => {
    hapticFeedback.sub();
    const now = Date.now();
    const currentSecs = currentSeconds;

    // Determine if playerOff is GK or outfield
    const isGK = match.activeGoalkeeperId === playerOffId;
    const isPowerplay = match.activePowerplayPlayerIds.includes(playerOffId);

    // End current stint for playerOff
    const updatedStints = match.stints.map((stint) => {
      if (stint.playerId === playerOffId && stint.endSecond === undefined) {
        return { ...stint, endSecond: currentSecs };
      }
      return stint;
    });

    // Start new stint for playerOn
    updatedStints.push({
      playerId: playerOnId,
      role: isGK ? 'goalkeeper' : 'outfield',
      startSecond: currentSecs
    });

    // Update active arrays
    let newGK = match.activeGoalkeeperId;
    let newOutfield = [...match.activeOutfieldPlayerIds];
    let newPowerplay = [...match.activePowerplayPlayerIds];
    let newBench = match.benchPlayerIds.filter((id) => id !== playerOnId);
    newBench.push(playerOffId);

    if (isGK) {
      newGK = playerOnId;
    } else if (isPowerplay) {
      newPowerplay = newPowerplay.filter((id) => id !== playerOffId);
      newPowerplay.push(playerOnId);
    } else {
      newOutfield = newOutfield.filter((id) => id !== playerOffId);
      newOutfield.push(playerOnId);
    }

    const newEvent: MatchEvent = {
      id: generateUUID(),
      matchId,
      type: isGK ? 'gk_swap' : 'substitution',
      timestampSeconds: currentSecs,
      period: match.currentPeriod,
      playerId: playerOnId,
      subOutPlayerId: playerOffId,
      notes: isGK ? 'GK substituted' : undefined,
      createdAt: now
    };

    await db.matches.update(matchId, {
      activeGoalkeeperId: newGK,
      activeOutfieldPlayerIds: newOutfield,
      activePowerplayPlayerIds: newPowerplay,
      benchPlayerIds: newBench,
      stints: updatedStints,
      events: [...match.events, newEvent]
    });

    setShowSubModal(false);
    setSelectedPitchPlayerForSub(null);
  };

  // --- Batch Substitution Handler ---
  const handleExecuteBatchSubs = async () => {
    if (batchPairs.length === 0) return;
    hapticFeedback.sub();
    const now = Date.now();
    const currentSecs = currentSeconds;

    let updatedStints = [...match.stints];
    let newGK = match.activeGoalkeeperId;
    let newOutfield = [...match.activeOutfieldPlayerIds];
    let newPowerplay = [...match.activePowerplayPlayerIds];
    let newBench = [...match.benchPlayerIds];
    const newEvents: MatchEvent[] = [];

    for (const pair of batchPairs) {
      const isGK = newGK === pair.offId;
      const isPowerplay = newPowerplay.includes(pair.offId);

      // Close stint
      updatedStints = updatedStints.map((stint) => {
        if (stint.playerId === pair.offId && stint.endSecond === undefined) {
          return { ...stint, endSecond: currentSecs };
        }
        return stint;
      });

      // Open new stint
      updatedStints.push({
        playerId: pair.onId,
        role: isGK ? 'goalkeeper' : 'outfield',
        startSecond: currentSecs
      });

      // Update squads
      newBench = newBench.filter((id) => id !== pair.onId);
      newBench.push(pair.offId);

      if (isGK) {
        newGK = pair.onId;
      } else if (isPowerplay) {
        newPowerplay = newPowerplay.filter((id) => id !== pair.offId);
        newPowerplay.push(pair.onId);
      } else {
        newOutfield = newOutfield.filter((id) => id !== pair.offId);
        newOutfield.push(pair.onId);
      }

      newEvents.push({
        id: generateUUID(),
        matchId,
        type: isGK ? 'gk_swap' : 'substitution',
        timestampSeconds: currentSecs,
        period: match.currentPeriod,
        playerId: pair.onId,
        subOutPlayerId: pair.offId,
        createdAt: now
      });
    }

    await db.matches.update(matchId, {
      activeGoalkeeperId: newGK,
      activeOutfieldPlayerIds: newOutfield,
      activePowerplayPlayerIds: newPowerplay,
      benchPlayerIds: newBench,
      stints: updatedStints,
      events: [...match.events, ...newEvents]
    });

    setBatchPairs([]);
    setShowBatchSubModal(false);
  };

  // --- Goalkeeper Swap (Pitch outfield or bench player switches with GK) ---
  const handleSwapGK = async (newGKId: string) => {
    if (!match.activeGoalkeeperId || newGKId === match.activeGoalkeeperId) return;
    hapticFeedback.tap();
    const now = Date.now();
    const currentSecs = currentSeconds;
    const oldGKId = match.activeGoalkeeperId;

    // Check if new GK was on pitch or on bench
    const wasOnPitch = match.activeOutfieldPlayerIds.includes(newGKId);

    // End stint for old GK and new GK
    let updatedStints = match.stints.map((stint) => {
      if ((stint.playerId === oldGKId || stint.playerId === newGKId) && stint.endSecond === undefined) {
        return { ...stint, endSecond: currentSecs };
      }
      return stint;
    });

    // Start new stint for new GK
    updatedStints.push({
      playerId: newGKId,
      role: 'goalkeeper',
      startSecond: currentSecs
    });

    let newOutfield = [...match.activeOutfieldPlayerIds];
    let newBench = [...match.benchPlayerIds];

    if (wasOnPitch) {
      // Old GK becomes outfield player
      updatedStints.push({
        playerId: oldGKId,
        role: 'outfield',
        startSecond: currentSecs
      });
      newOutfield = newOutfield.filter((id) => id !== newGKId);
      newOutfield.push(oldGKId);
    } else {
      // New GK came from bench; Old GK goes to bench
      newBench = newBench.filter((id) => id !== newGKId);
      newBench.push(oldGKId);
    }

    const newEvent: MatchEvent = {
      id: generateUUID(),
      matchId,
      type: 'gk_swap',
      timestampSeconds: currentSecs,
      period: match.currentPeriod,
      playerId: newGKId,
      subOutPlayerId: oldGKId,
      notes: wasOnPitch ? 'Swapped roles with outfield player' : 'Replaced from bench',
      createdAt: now
    };

    await db.matches.update(matchId, {
      activeGoalkeeperId: newGKId,
      activeOutfieldPlayerIds: newOutfield,
      benchPlayerIds: newBench,
      stints: updatedStints,
      events: [...match.events, newEvent]
    });

    setShowGKSwapModal(false);
  };

  // --- Extra Player / Player Count Handlers (Powerplay & Format Changes) ---
  const handleAddPowerplayPlayer = async (playerId: string, reason = 'Extra player added') => {
    hapticFeedback.tap();
    const now = Date.now();
    const currentSecs = currentSeconds;

    // Add stint for extra player
    const updatedStints = [
      ...match.stints,
      {
        playerId,
        role: 'outfield' as const,
        startSecond: currentSecs
      }
    ];

    const newBench = match.benchPlayerIds.filter((id) => id !== playerId);
    const newPowerplay = [...match.activePowerplayPlayerIds, playerId];

    const playerName = playerMap.get(playerId)?.name || 'Player';
    const newEvent: MatchEvent = {
      id: generateUUID(),
      matchId,
      type: 'powerplay_in',
      timestampSeconds: currentSecs,
      period: match.currentPeriod,
      playerId,
      notes: `${playerName} brought on (${reason})`,
      createdAt: now
    };

    await db.matches.update(matchId, {
      activePowerplayPlayerIds: newPowerplay,
      benchPlayerIds: newBench,
      stints: updatedStints,
      events: [...match.events, newEvent]
    });

    setShowPowerplayModal(false);
  };

  const handleRemovePowerplayPlayer = async (playerId: string) => {
    hapticFeedback.tap();
    const now = Date.now();
    const currentSecs = currentSeconds;

    // End stint
    const updatedStints = match.stints.map((stint) => {
      if (stint.playerId === playerId && stint.endSecond === undefined) {
        return { ...stint, endSecond: currentSecs };
      }
      return stint;
    });

    const newPowerplay = match.activePowerplayPlayerIds.filter((id) => id !== playerId);
    const newBench = [...match.benchPlayerIds, playerId];

    const playerName = playerMap.get(playerId)?.name || 'Player';
    const newEvent: MatchEvent = {
      id: generateUUID(),
      matchId,
      type: 'powerplay_out',
      timestampSeconds: currentSecs,
      period: match.currentPeriod,
      playerId,
      notes: `${playerName} withdrawn to bench`,
      createdAt: now
    };

    await db.matches.update(matchId, {
      activePowerplayPlayerIds: newPowerplay,
      benchPlayerIds: newBench,
      stints: updatedStints,
      events: [...match.events, newEvent]
    });
  };

  // Withdraw any pitch player to bench without a replacement (reducing player count)
  const handleTakePlayerOff = async (playerId: string) => {
    hapticFeedback.tap();
    const now = Date.now();
    const currentSecs = currentSeconds;

    if (match.activePowerplayPlayerIds.includes(playerId)) {
      await handleRemovePowerplayPlayer(playerId);
      return;
    }

    // End current stint
    const updatedStints = match.stints.map((stint) => {
      if (stint.playerId === playerId && stint.endSecond === undefined) {
        return { ...stint, endSecond: currentSecs };
      }
      return stint;
    });

    const newOutfield = match.activeOutfieldPlayerIds.filter((id) => id !== playerId);
    const newBench = [...match.benchPlayerIds, playerId];

    const playerName = playerMap.get(playerId)?.name || 'Player';
    const newEvent: MatchEvent = {
      id: generateUUID(),
      matchId,
      type: 'powerplay_out',
      timestampSeconds: currentSecs,
      period: match.currentPeriod,
      playerId,
      notes: `${playerName} taken off (reduced player count)`,
      createdAt: now
    };

    await db.matches.update(matchId, {
      activeOutfieldPlayerIds: newOutfield,
      benchPlayerIds: newBench,
      stints: updatedStints,
      events: [...match.events, newEvent]
    });

    setShowSubModal(false);
    setSelectedPitchPlayerForSub(null);
  };

  // --- One-Tap Undo Action ---
  const handleUndoLastEvent = async () => {
    if (match.events.length <= 1) return; // don't undo period_start if only 1 event
    hapticFeedback.tap();
    const lastEvent = match.events[match.events.length - 1];

    if (lastEvent.type === 'goal_for') {
      await db.matches.update(matchId, {
        scoreFor: Math.max(0, match.scoreFor - 1),
        events: match.events.slice(0, -1)
      });
    } else if (lastEvent.type === 'goal_against') {
      await db.matches.update(matchId, {
        scoreAgainst: Math.max(0, match.scoreAgainst - 1),
        events: match.events.slice(0, -1)
      });
    } else if (lastEvent.type === 'substitution' || lastEvent.type === 'gk_swap') {
      // Revert player on and off
      const playerOnId = lastEvent.playerId;
      const playerOffId = lastEvent.subOutPlayerId;

      if (playerOnId && playerOffId) {
        // Remove the stint for playerOn that started around this event
        const updatedStints = match.stints.filter(
          (s) => !(s.playerId === playerOnId && s.startSecond === lastEvent.timestampSeconds)
        ).map((s) => {
          // Re-open the stint for playerOff
          if (s.playerId === playerOffId && s.endSecond === lastEvent.timestampSeconds) {
            return { ...s, endSecond: undefined };
          }
          return s;
        });

        const isGK = lastEvent.type === 'gk_swap' || match.activeGoalkeeperId === playerOnId;
        let newGK = match.activeGoalkeeperId;
        let newOutfield = [...match.activeOutfieldPlayerIds];
        let newBench = match.benchPlayerIds.filter((id) => id !== playerOffId);
        newBench.push(playerOnId);

        if (isGK) {
          newGK = playerOffId;
        } else {
          newOutfield = newOutfield.filter((id) => id !== playerOnId);
          newOutfield.push(playerOffId);
        }

        await db.matches.update(matchId, {
          activeGoalkeeperId: newGK,
          activeOutfieldPlayerIds: newOutfield,
          benchPlayerIds: newBench,
          stints: updatedStints,
          events: match.events.slice(0, -1)
        });
      }
    } else if (lastEvent.type === 'powerplay_in' && lastEvent.playerId) {
      const pid = lastEvent.playerId;
      const updatedStints = match.stints.filter(
        (s) => !(s.playerId === pid && s.startSecond === lastEvent.timestampSeconds)
      );
      const newPowerplay = match.activePowerplayPlayerIds.filter((id) => id !== pid);
      const newBench = match.benchPlayerIds.includes(pid) ? match.benchPlayerIds : [...match.benchPlayerIds, pid];

      await db.matches.update(matchId, {
        activePowerplayPlayerIds: newPowerplay,
        benchPlayerIds: newBench,
        stints: updatedStints,
        events: match.events.slice(0, -1)
      });
    } else if (lastEvent.type === 'powerplay_out' && lastEvent.playerId) {
      const pid = lastEvent.playerId;
      const updatedStints = match.stints.map((s) => {
        if (s.playerId === pid && s.endSecond === lastEvent.timestampSeconds) {
          return { ...s, endSecond: undefined };
        }
        return s;
      });
      const newBench = match.benchPlayerIds.filter((id) => id !== pid);
      const newPowerplay = [...match.activePowerplayPlayerIds, pid];

      await db.matches.update(matchId, {
        activePowerplayPlayerIds: newPowerplay,
        benchPlayerIds: newBench,
        stints: updatedStints,
        events: match.events.slice(0, -1)
      });
    } else {
      // Generic event undo
      await db.matches.update(matchId, {
        events: match.events.slice(0, -1)
      });
    }
  };

  // --- Next Period / Halftime Handler ---
  const handleTransitionNextPeriod = async () => {
    hapticFeedback.period();
    sound.playWhistle(0.4, 2);
    const now = Date.now();
    const currentSecs = currentSeconds;
    const nextPeriod = match.currentPeriod + 1;

    const newEvent: MatchEvent = {
      id: generateUUID(),
      matchId,
      type: 'period_start',
      timestampSeconds: currentSecs,
      period: nextPeriod,
      notes: `Period ${nextPeriod} started`,
      createdAt: now
    };

    await db.matches.update(matchId, {
      currentPeriod: nextPeriod,
      events: [...match.events, newEvent]
    });

    setShowNextPeriodModal(false);
  };

  // --- Planned Substitution Handlers ---
  const handleApplyPlannedSub = async (sub: PlannedSubstitution) => {
    hapticFeedback.sub();
    const now = Date.now();
    const currentSecs = currentSeconds;

    let updatedStints = [...match.stints];
    let newGK = match.activeGoalkeeperId;
    let newOutfield = [...match.activeOutfieldPlayerIds];
    let newBench = [...match.benchPlayerIds];
    const newEvents: MatchEvent[] = [];

    if (sub.targetGoalkeeperId && sub.targetOutfieldPlayerIds) {
      const targetGK = sub.targetGoalkeeperId;
      const targetOutfieldSet = new Set(sub.targetOutfieldPlayerIds);

      // Close open stints for anyone no longer in that role
      updatedStints = updatedStints.map((stint) => {
        if (stint.endSecond === undefined) {
          if (stint.role === 'goalkeeper' && stint.playerId !== targetGK) {
            return { ...stint, endSecond: currentSecs };
          }
          if (stint.role === 'outfield' && !targetOutfieldSet.has(stint.playerId)) {
            return { ...stint, endSecond: currentSecs };
          }
        }
        return stint;
      });

      // GK change if applicable
      if (newGK !== targetGK) {
        updatedStints.push({
          playerId: targetGK,
          role: 'goalkeeper',
          startSecond: currentSecs
        });

        newEvents.push({
          id: generateUUID(),
          matchId,
          type: 'gk_swap',
          timestampSeconds: currentSecs,
          period: match.currentPeriod,
          playerId: targetGK,
          subOutPlayerId: newGK,
          notes: `Planned GK rotation at ${sub.label}`,
          createdAt: now
        });
      }

      // Open new stints for outfielders who don't already have an open stint
      for (const pId of sub.targetOutfieldPlayerIds) {
        const hasOpenStint = updatedStints.some(
          (s) => s.playerId === pId && s.role === 'outfield' && s.endSecond === undefined
        );
        if (!hasOpenStint) {
          updatedStints.push({
            playerId: pId,
            role: 'outfield',
            startSecond: currentSecs
          });
        }
      }

      // Record outfield substitution events
      if (sub.outfieldChanges && sub.outfieldChanges.length > 0) {
        sub.outfieldChanges.forEach((chg) => {
          newEvents.push({
            id: generateUUID(),
            matchId,
            type: 'substitution',
            timestampSeconds: currentSecs,
            period: match.currentPeriod,
            playerId: chg.inPlayerId,
            subOutPlayerId: chg.outPlayerId,
            notes: `Planned substitution at ${sub.label}`,
            createdAt: now
          });
        });
      }

      newGK = targetGK;
      newOutfield = sub.targetOutfieldPlayerIds;
      newBench = sub.targetBenchPlayerIds || newBench;
    }

    // Mark this planned sub as applied
    const updatedPlanned = (match.plannedSubstitutions || []).map((s) =>
      s.id === sub.id ? { ...s, applied: true } : s
    );

    await db.matches.update(matchId, {
      activeGoalkeeperId: newGK,
      activeOutfieldPlayerIds: newOutfield,
      benchPlayerIds: newBench,
      stints: updatedStints,
      events: [...match.events, ...newEvents],
      plannedSubstitutions: updatedPlanned
    });

    sound.playWhistle(0.25, 1);
  };

  const handleDismissPlannedSub = async (subId: string) => {
    hapticFeedback.tap();
    const updatedPlanned = (match.plannedSubstitutions || []).map((s) =>
      s.id === subId ? { ...s, dismissed: true } : s
    );
    await db.matches.update(matchId, {
      plannedSubstitutions: updatedPlanned
    });
  };

  const handleSnoozePlannedSub = async (subId: string, addSeconds = 60) => {
    hapticFeedback.tap();
    alertedSubIdsRef.current.delete(subId);
    const updatedPlanned = (match.plannedSubstitutions || []).map((s) =>
      s.id === subId ? { ...s, timestampSeconds: currentSeconds + addSeconds } : s
    );
    await db.matches.update(matchId, {
      plannedSubstitutions: updatedPlanned
    });
  };

  // --- End Match Handler ---
  const handleEndMatch = async (startNextDirectly = false) => {
    hapticFeedback.period();
    sound.playWhistle(0.6, 3);
    const now = Date.now();
    const currentSecs = currentSeconds;

    // Close all open stints at currentSecs
    const finalStints = match.stints.map((stint) => {
      if (stint.endSecond === undefined) {
        return { ...stint, endSecond: currentSecs };
      }
      return stint;
    });

    const finalEvent: MatchEvent = {
      id: generateUUID(),
      matchId,
      type: 'period_end',
      timestampSeconds: currentSecs,
      period: match.currentPeriod,
      notes: 'Full Time - Match Ended',
      createdAt: now
    };

    await db.matches.update(matchId, {
      status: 'completed',
      elapsedSeconds: currentSecs,
      lastStartedAt: undefined,
      stints: finalStints,
      events: [...match.events, finalEvent],
      completedAt: now,
      playerOfTheMatchId: selectedPotmId || undefined
    });

    setShowEndMatchModal(false);

    if (startNextDirectly && match.nextMatchId && nextMatch) {
      // Start next match in matchday session!
      const nextInitialStints: PlayerMatchStint[] = [];
      if (nextMatch.startingGoalkeeperId) {
        nextInitialStints.push({
          playerId: nextMatch.startingGoalkeeperId,
          role: 'goalkeeper',
          startSecond: 0
        });
      }
      nextMatch.startingOutfieldPlayerIds.forEach((pId) => {
        nextInitialStints.push({
          playerId: pId,
          role: 'outfield',
          startSecond: 0
        });
      });

      await db.matches.update(match.nextMatchId, {
        status: 'in_progress',
        lastStartedAt: now,
        activeGoalkeeperId: nextMatch.startingGoalkeeperId,
        activeOutfieldPlayerIds: nextMatch.startingOutfieldPlayerIds,
        benchPlayerIds: nextMatch.benchPlayerIds,
        stints: nextInitialStints,
        events: [
          {
            id: generateUUID(),
            matchId: match.nextMatchId,
            type: 'period_start',
            timestampSeconds: 0,
            period: 1,
            notes: 'Match kick-off',
            createdAt: now
          }
        ]
      });

      sound.playWhistle(0.4, 2);
      router.push(`/teams/${teamId}/matches/${match.nextMatchId}`);
    } else {
      router.push(`/teams/${teamId}/results/${matchId}`);
    }
  };

  // Helper to calculate minutes played so far in this match for a given player
  const getPlayerLiveMinutes = (playerId: string) => {
    let totalSecs = 0;
    for (const stint of match.stints) {
      if (stint.playerId === playerId) {
        const endSec = stint.endSecond ?? currentSeconds;
        totalSecs += Math.max(0, endSec - stint.startSecond);
      }
    }
    return formatTimeShort(totalSecs);
  };

  // Active pitch lineups
  const activeGK = match.activeGoalkeeperId ? playerMap.get(match.activeGoalkeeperId) : null;
  const activeOutfield = match.activeOutfieldPlayerIds
    .map((id) => playerMap.get(id))
    .filter(Boolean);
  const activePowerplay = match.activePowerplayPlayerIds
    .map((id) => playerMap.get(id))
    .filter(Boolean);
  const benchPlayers = match.benchPlayerIds
    .map((id) => playerMap.get(id))
    .filter(Boolean);

  const lastEvent = match.events[match.events.length - 1];

  // Active planned substitution due right now
  const duePlannedSub = match.plannedSubstitutions?.find(
    (s) => !s.applied && !s.dismissed && currentSeconds >= s.timestampSeconds
  );

  // Next planned substitution coming up in the future
  const nextUpcomingPlannedSub = match.plannedSubstitutions?.find(
    (s) => !s.applied && !s.dismissed && currentSeconds < s.timestampSeconds
  );

  return (
    <>
      <Navbar
        showBack
        backHref={`/teams/${teamId}`}
        title={`${team.name} vs ${match.opposition}`}
        subtitle={
          match.matchGroupTotal && match.matchGroupTotal > 1
            ? `Game ${match.matchGroupIndex || 1} of ${match.matchGroupTotal} • ${match.format} • ${match.currentPeriod === 1 ? '1st Half' : match.currentPeriod === 2 ? '2nd Half' : `Period ${match.currentPeriod}`}`
            : `${match.format} • ${match.currentPeriod === 1 ? '1st Half' : match.currentPeriod === 2 ? '2nd Half' : `Period ${match.currentPeriod}`}`
        }
        rightAction={
          match.status === 'setup' ? (
            <button
              onClick={handleCancelSetup}
              className="btn btn-ghost"
              style={{ minHeight: '34px', padding: '4px 10px', fontSize: '0.8rem', color: 'var(--text-muted)' }}
            >
              Cancel Setup
            </button>
          ) : (
            <button
              onClick={() => setShowEndMatchModal(true)}
              className="btn btn-danger"
              style={{ minHeight: '34px', padding: '4px 10px', fontSize: '0.8rem' }}
            >
              End Match
            </button>
          )
        }
      />

      <main className="main-content" style={{ paddingBottom: '90px' }}>
        {/* Pre-Match Setup Review Banner (when ready for kick-off) */}
        {match.status === 'setup' && (
          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.15) 0%, rgba(16, 185, 129, 0.15) 100%)',
              border: '1.5px solid var(--sub-blue)',
              padding: '14px 16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              boxShadow: '0 4px 16px rgba(14, 165, 233, 0.15)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Sparkles size={20} color="var(--sub-blue)" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 800, color: '#fff', fontSize: '0.92rem' }}>
                  Matchday Setup Saved & Ready
                </div>
                <div style={{ fontSize: '0.78rem', color: 'rgba(255, 255, 255, 0.85)', marginTop: '2px' }}>
                  Review starting lineup, bench, and rotation plan below. When ready, tap <strong>Kick Off</strong> above.
                </div>
              </div>
            </div>
            {match.plannedSubstitutions && match.plannedSubstitutions.length > 0 && (
              <button
                type="button"
                onClick={() => setShowScheduleModal(true)}
                className="btn btn-secondary"
                style={{ minHeight: '34px', padding: '4px 12px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
              >
                View Plan
              </button>
            )}
          </div>
        )}

        {/* Match HUD Scoreboard & Clock */}
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, #101926 0%, #172437 100%)',
            border: '1.5px solid var(--border-subtle)',
            padding: '16px 14px',
            marginBottom: '14px',
            textAlign: 'center'
          }}
        >
          {/* Top Clock Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {match.status === 'setup' ? (
                <span
                  className="badge"
                  style={{
                    background: 'rgba(14, 165, 233, 0.25)',
                    color: '#38bdf8',
                    border: '1px solid #0284c7',
                    fontWeight: 800,
                    fontSize: '0.75rem',
                    letterSpacing: '0.5px'
                  }}
                >
                  READY FOR KICK-OFF
                </span>
              ) : (
                <span className="badge badge-green">
                  {match.currentPeriod === 1 ? '1ST HALF' : match.currentPeriod === 2 ? '2ND HALF' : `PERIOD ${match.currentPeriod}`}
                </span>
              )}
              <span className="wake-lock-active" title="Screen kept awake">
                <SunMedium size={14} /> Screen Awake
              </span>
              <button
                type="button"
                onClick={handleToggleSound}
                style={{
                  padding: '2px 8px',
                  minHeight: '22px',
                  fontSize: '0.72rem',
                  borderRadius: '12px',
                  background: soundActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                  color: soundActive ? 'var(--pitch-green-light)' : 'var(--text-muted)',
                  border: '1px solid ' + (soundActive ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-subtle)'),
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer'
                }}
                title={soundActive ? 'Sound is on (Whistle & alerts). Tap to mute.' : 'Sound is muted (Vibration only). Tap to enable.'}
              >
                {soundActive ? <Volume2 size={13} /> : <VolumeX size={13} />}
                <span>{soundActive ? 'Sound On' : 'Muted'}</span>
              </button>
            </div>

            {/* Target time indication */}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Target: {match.periodDurationMinutes * match.currentPeriod}m
            </div>
          </div>

          {/* Clock Display */}
          <div
            className="tabular-nums"
            style={{
              fontSize: '3.4rem',
              fontWeight: 800,
              letterSpacing: '1px',
              lineHeight: 1,
              marginBottom: '12px',
              color: isRunning ? 'var(--pitch-green-light)' : match.status === 'setup' ? '#38bdf8' : 'var(--text-secondary)',
              textShadow: isRunning ? '0 0 20px var(--pitch-green-glow)' : 'none'
            }}
          >
            {formatMMSS(currentSeconds)}
          </div>

          {/* Clock Control Buttons */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '16px' }}>
            {match.status === 'setup' ? (
              <button
                onClick={handleToggleTimer}
                className="btn btn-lg btn-primary"
                style={{
                  minWidth: '220px',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  boxShadow: '0 4px 20px var(--pitch-green-glow)',
                  fontWeight: 800,
                  fontSize: '1.05rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <Play size={22} fill="#000" /> Kick Off & Start Match
              </button>
            ) : (
              <button
                onClick={handleToggleTimer}
                className={`btn btn-lg ${isRunning ? 'btn-secondary' : 'btn-primary'}`}
                style={{
                  minWidth: '150px',
                  boxShadow: isRunning ? 'none' : '0 4px 16px var(--pitch-green-glow)'
                }}
              >
                {isRunning ? (
                  <>
                    <Pause size={20} /> Pause Timer
                  </>
                ) : (
                  <>
                    <Play size={20} fill="#000" /> Resume Timer
                  </>
                )}
              </button>
            )}

            {/* Next Period Trigger */}
            {match.status !== 'setup' && match.currentPeriod < match.targetPeriods && (
              <button
                onClick={() => setShowNextPeriodModal(true)}
                className="btn btn-secondary"
                title="Advance to next half"
              >
                Next Half →
              </button>
            )}
          </div>

          {/* Score Counter Bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              padding: '12px',
              gap: '10px'
            }}
          >
            {/* Home Team */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                {team.name}
              </div>
              <div className="tabular-nums" style={{ fontSize: '2.4rem', fontWeight: 900, color: '#fff' }}>
                {match.scoreFor}
              </div>
              <button
                onClick={() => setShowGoalModal(true)}
                className="btn btn-primary btn-block"
                style={{ minHeight: '38px', padding: '6px', fontSize: '0.85rem', marginTop: '6px' }}
              >
                <Plus size={16} /> + Goal
              </button>
            </div>

            {/* Score Divider */}
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-muted)' }}>
              :
            </div>

            {/* Away Team */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                {match.opposition}
              </div>
              <div className="tabular-nums" style={{ fontSize: '2.4rem', fontWeight: 900, color: '#fff' }}>
                {match.scoreAgainst}
              </div>
              <button
                onClick={handleScoreAwayGoal}
                className="btn btn-danger btn-block"
                style={{ minHeight: '38px', padding: '6px', fontSize: '0.85rem', marginTop: '6px' }}
              >
                <Plus size={16} /> + Goal
              </button>
            </div>
          </div>
        </div>

        {/* Planned Substitution Alert Card (when due) */}
        {duePlannedSub && (
          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, #132438 0%, #1a324e 100%)',
              border: '2px solid var(--pitch-green)',
              boxShadow: '0 0 25px var(--pitch-green-glow)',
              padding: '16px',
              marginBottom: '16px',
              animation: 'pulseGlow 2.5s infinite ease-in-out'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.25rem' }}>🔔</span>
                <span style={{ fontWeight: 800, fontSize: '1rem', color: '#fff' }}>
                  Time for Substitution ({duePlannedSub.label})
                </span>
              </div>
              <span
                style={{
                  background: 'var(--pitch-green)',
                  color: '#000',
                  fontWeight: 800,
                  fontSize: '0.72rem',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)'
                }}
              >
                SCHEDULED
              </span>
            </div>

            {/* Changes list */}
            <div
              style={{
                background: 'var(--bg-primary)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
                marginBottom: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontSize: '0.86rem'
              }}
            >
              {duePlannedSub.gkChange && (
                <div style={{ color: 'var(--gk-gold)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <GoalkeeperIcon size={16} color="var(--gk-gold)" />
                  <span>
                    <strong>GK:</strong> {playerMap.get(duePlannedSub.gkChange.inPlayerId)?.name} in for {playerMap.get(duePlannedSub.gkChange.outPlayerId || '')?.name}
                  </span>
                </div>
              )}
              {duePlannedSub.outfieldChanges.map((chg, i) => (
                <div key={i} style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ArrowRightLeft size={14} color="var(--sub-blue)" />
                  <span>
                    <strong style={{ color: 'var(--pitch-green-light)' }}>{playerMap.get(chg.inPlayerId)?.name}</strong> ON ↔️ <span style={{ color: '#fca5a5' }}>{playerMap.get(chg.outPlayerId)?.name}</span> OFF
                  </span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => handleApplyPlannedSub(duePlannedSub)}
                className="btn btn-primary"
                style={{ flex: 2, minHeight: '44px', fontWeight: 800, fontSize: '0.92rem' }}
              >
                <Check size={18} strokeWidth={3} />
                Apply Planned Changes
              </button>
              <button
                type="button"
                onClick={() => handleSnoozePlannedSub(duePlannedSub.id, 60)}
                className="btn btn-secondary"
                style={{ flex: 1, minHeight: '44px', fontSize: '0.85rem' }}
              >
                +1 Min
              </button>
              <button
                type="button"
                onClick={() => handleDismissPlannedSub(duePlannedSub.id)}
                className="btn btn-ghost"
                style={{ minHeight: '44px', padding: '4px 10px', fontSize: '0.8rem' }}
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* Next Upcoming Rotation Pill */}
        {!duePlannedSub && nextUpcomingPlannedSub && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              marginBottom: '14px',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={15} color="var(--sub-blue)" />
              <span>
                Next rotation at <strong>{nextUpcomingPlannedSub.label}</strong> (in {formatTimeShort(nextUpcomingPlannedSub.timestampSeconds - currentSeconds)}):
                {' '}
                {nextUpcomingPlannedSub.gkChange ? '🧤 GK Swap • ' : ''}
                {nextUpcomingPlannedSub.outfieldChanges.length} sub{nextUpcomingPlannedSub.outfieldChanges.length === 1 ? '' : 's'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowScheduleModal(true)}
              className="btn btn-ghost"
              style={{ minHeight: '28px', padding: '2px 8px', fontSize: '0.75rem', color: 'var(--pitch-green)' }}
            >
              View Plan
            </button>
          </div>
        )}

        {/* Tactical Controls Bar (Batch Subs, Swap GK, Powerplay, History, Plan) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: match.plannedSubstitutions && match.plannedSubstitutions.length > 0 ? 'repeat(5, 1fr)' : 'repeat(4, 1fr)',
            gap: '6px',
            marginBottom: '16px'
          }}
        >
          <button
            onClick={() => setShowBatchSubModal(true)}
            className="btn btn-secondary"
            style={{ flexDirection: 'column', minHeight: '52px', padding: '6px 4px', fontSize: '0.72rem', gap: '3px' }}
          >
            <ArrowRightLeft size={16} color="var(--sub-blue)" />
            Batch Subs
          </button>

          <button
            onClick={() => setShowGKSwapModal(true)}
            className="btn btn-secondary"
            style={{ flexDirection: 'column', minHeight: '52px', padding: '6px 4px', fontSize: '0.72rem', gap: '3px' }}
          >
            <GoalkeeperIcon size={18} color="var(--gk-gold)" />
            Swap GK
          </button>

          <button
            onClick={() => {
              setExtraPlayerModalTab('add');
              setShowPowerplayModal(true);
            }}
            className="btn btn-secondary"
            style={{ flexDirection: 'column', minHeight: '52px', padding: '6px 4px', fontSize: '0.72rem', gap: '3px' }}
          >
            <UserPlus size={16} color="var(--powerplay-purple)" />
            {activePowerplay.length > 0 ? `Extra (+${activePowerplay.length})` : 'Extra Player'}
          </button>

          <button
            onClick={() => setShowEventsModal(true)}
            className="btn btn-secondary"
            style={{ flexDirection: 'column', minHeight: '52px', padding: '6px 4px', fontSize: '0.72rem', gap: '3px' }}
          >
            <History size={16} color="var(--text-muted)" />
            Events ({match.events.length})
          </button>

          {match.plannedSubstitutions && match.plannedSubstitutions.length > 0 && (
            <button
              onClick={() => setShowScheduleModal(true)}
              className="btn btn-secondary"
              style={{ flexDirection: 'column', minHeight: '52px', padding: '6px 4px', fontSize: '0.72rem', gap: '3px' }}
            >
              <Sparkles size={16} color="var(--pitch-green)" />
              Plan
            </button>
          )}
        </div>

        {/* Live Pitch Lineup Section */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--pitch-green)' }} />
              On Pitch ({activeOutfield.length + (activeGK ? 1 : 0) + activePowerplay.length})
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>Quick actions: ⚽ Goal •</span>
              <GoalkeeperIcon size={13} color="var(--gk-gold)" />
              <span>GK • 🔄 Sub</span>
            </div>
          </div>

          {/* Goalkeeper Card */}
          {activeGK && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1.5px solid var(--gk-gold)',
                marginBottom: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: 'var(--gk-gold)',
                    color: '#000',
                    fontWeight: 800,
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  GK
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {activeGK.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                    <span className="badge badge-gold tabular-nums" style={{ fontSize: '0.7rem', padding: '1px 6px' }}>
                      <Clock size={10} /> {getPlayerLiveMinutes(activeGK.id)}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--gk-gold-light)', fontWeight: 600 }}>
                      Goalkeeper
                    </span>
                  </div>
                </div>
              </div>

              <div className="player-actions-group">
                {/* 1. Goal Scored */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleScoreHomeGoal(activeGK.id);
                  }}
                  className="player-action-btn btn-action-goal"
                  title={`Record Goal for ${activeGK.name}`}
                >
                  <span style={{ fontSize: '0.9rem' }}>⚽</span>
                </button>

                {/* 2. Rotate GK */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowGKSwapModal(true);
                  }}
                  className="player-action-btn btn-action-gk"
                  title="Rotate Goalkeeper"
                >
                  <GoalkeeperIcon size={17} />
                </button>

                {/* 3. Sub Off */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPitchPlayerForSub(activeGK.id);
                    setShowSubModal(true);
                  }}
                  className="player-action-btn btn-action-sub"
                  title={`Substitute ${activeGK.name} off`}
                >
                  <ArrowRightLeft size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Outfield Starters Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {activeOutfield.map((player) => (
              <div
                key={player!.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  transition: 'background 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: 'var(--bg-elevated)',
                      color: 'var(--pitch-green-light)',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    {player!.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {player!.name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                      <span className="badge badge-green tabular-nums" style={{ fontSize: '0.7rem', padding: '1px 6px' }}>
                        <Clock size={10} /> {getPlayerLiveMinutes(player!.id)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="player-actions-group">
                  {/* 1. Goal Scored */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleScoreHomeGoal(player!.id);
                    }}
                    className="player-action-btn btn-action-goal"
                    title={`Record Goal for ${player!.name}`}
                  >
                    <span style={{ fontSize: '0.9rem' }}>⚽</span>
                  </button>

                  {/* 2. Swap to GK */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmGKSwapPlayerId(player!.id);
                    }}
                    className="player-action-btn btn-action-gk"
                    title={`Swap ${player!.name} to Goalkeeper`}
                  >
                    <GoalkeeperIcon size={17} />
                  </button>

                  {/* 3. Sub Off */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPitchPlayerForSub(player!.id);
                      setShowSubModal(true);
                    }}
                    className="player-action-btn btn-action-sub"
                    title={`Substitute ${player!.name} off`}
                  >
                    <ArrowRightLeft size={16} />
                  </button>
                </div>
              </div>
            ))}

            {/* Extra players (e.g. 6-a-side / powerplay) */}
            {activePowerplay.map((player) => (
              <div
                key={player!.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(168, 85, 247, 0.12)',
                  border: '1.5px solid var(--powerplay-purple)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: 'var(--powerplay-purple)',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    +1
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {player!.name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                      <span className="badge badge-purple tabular-nums" style={{ fontSize: '0.7rem', padding: '1px 6px' }}>
                        <Clock size={10} /> {getPlayerLiveMinutes(player!.id)}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--powerplay-purple)', fontWeight: 600 }}>
                        Extra Player
                      </span>
                    </div>
                  </div>
                </div>

                <div className="player-actions-group">
                  {/* 1. Goal Scored */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleScoreHomeGoal(player!.id);
                    }}
                    className="player-action-btn btn-action-goal"
                    title={`Record Goal for ${player!.name}`}
                  >
                    <span style={{ fontSize: '0.9rem' }}>⚽</span>
                  </button>

                  {/* 2. Sub Off */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPitchPlayerForSub(player!.id);
                      setShowSubModal(true);
                    }}
                    className="player-action-btn btn-action-sub"
                    title={`Substitute ${player!.name} off`}
                  >
                    <ArrowRightLeft size={16} />
                  </button>

                  {/* 3. Take Off */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePowerplayPlayer(player!.id);
                    }}
                    className="player-action-btn"
                    style={{ color: 'var(--danger-red)', borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.1)' }}
                    title="Withdraw extra player to bench"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bench / Substitutes Section */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div className="card-title" style={{ margin: 0 }}>
              Bench ({benchPlayers.length})
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Available substitutes
            </div>
          </div>

          {benchPlayers.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {benchPlayers.map((player) => (
                <div
                  key={player!.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {player!.name}
                    </div>
                    <span className="badge badge-muted tabular-nums" style={{ fontSize: '0.7rem' }}>
                      {getPlayerLiveMinutes(player!.id)}
                    </span>
                  </div>

                  <div className="player-actions-group">
                    <button
                      onClick={() => setBenchSubTargetPlayerId(player!.id)}
                      className="player-action-btn btn-action-sub"
                      style={{ minWidth: 'auto', padding: '0 10px', fontSize: '0.75rem', gap: '4px' }}
                      title={`Sub ${player!.name} on`}
                    >
                      <ArrowRightLeft size={13} /> Sub In
                    </button>
                    <button
                      onClick={() => handleAddPowerplayPlayer(player!.id, '6-a-side / Extra Player')}
                      className="player-action-btn btn-action-extra"
                      style={{ minWidth: 'auto', padding: '0 8px', fontSize: '0.75rem', gap: '2px' }}
                      title={`Bring ${player!.name} on as Extra Player`}
                    >
                      <UserPlus size={13} /> +1
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>
              No substitutes remaining on bench.
            </div>
          )}
        </div>


        {/* Live Feed & Undo Bar (Fixed Bottom Tray) */}
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '100%',
            maxWidth: '540px',
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border-strong)',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            zIndex: 30,
            backdropFilter: 'blur(10px)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', flex: 1 }}>
            <History size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              {lastEvent ? (
                <>
                  <strong style={{ color: 'var(--text-primary)' }}>{formatMMSS(lastEvent.timestampSeconds)}:</strong>{' '}
                  {lastEvent.type === 'goal_for' && `⚽ Goal (${playerMap.get(lastEvent.playerId || '')?.name || 'Home'})`}
                  {lastEvent.type === 'goal_against' && `Goal Against (${match.opposition})`}
                  {lastEvent.type === 'substitution' && `Sub: ${playerMap.get(lastEvent.playerId || '')?.name} ON, ${playerMap.get(lastEvent.subOutPlayerId || '')?.name} OFF`}
                  {lastEvent.type === 'powerplay_in' && (lastEvent.notes || `Extra Player: ${playerMap.get(lastEvent.playerId || '')?.name} ON`)}
                  {lastEvent.type === 'powerplay_out' && (lastEvent.notes || `Player Withdrawn: ${playerMap.get(lastEvent.playerId || '')?.name} OFF`)}
                  {lastEvent.type === 'period_start' && lastEvent.notes}
                  {lastEvent.type === 'period_end' && lastEvent.notes}
                </>
              ) : (
                'Match started'
              )}
            </div>
          </div>

          <button
            onClick={handleUndoLastEvent}
            disabled={match.events.length <= 1}
            className="btn btn-secondary"
            style={{
              minHeight: '36px',
              padding: '6px 12px',
              fontSize: '0.8rem',
              flexShrink: 0
            }}
          >
            <RotateCcw size={14} /> Undo
          </button>
        </div>
      </main>

      {/* --- MODALS --- */}

      {/* 1. Goal Scorer Selection Modal */}
      {showGoalModal && (
        <div className="modal-overlay" onClick={() => setShowGoalModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">⚽ Who Scored?</h2>
              <button className="icon-button" onClick={() => setShowGoalModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '60vh', overflowY: 'auto' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                On Pitch Players:
              </div>

              {activeOutfield.map((player) => (
                <button
                  key={player!.id}
                  onClick={() => handleScoreHomeGoal(player!.id)}
                  className="btn btn-secondary"
                  style={{ justifyContent: 'space-between', padding: '12px 16px' }}
                >
                  <span style={{ fontWeight: 700 }}>{player!.name}</span>
                  <span className="badge badge-green">Pitch</span>
                </button>
              ))}

              {activeGK && (
                <button
                  onClick={() => handleScoreHomeGoal(activeGK.id)}
                  className="btn btn-secondary"
                  style={{ justifyContent: 'space-between', padding: '12px 16px' }}
                >
                  <span style={{ fontWeight: 700 }}>{activeGK.name}</span>
                  <span className="badge badge-gold">Goalkeeper</span>
                </button>
              )}

              {benchPlayers.length > 0 && (
                <>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px', marginBottom: '4px' }}>
                    Bench Players:
                  </div>
                  {benchPlayers.map((player) => (
                    <button
                      key={player!.id}
                      onClick={() => handleScoreHomeGoal(player!.id)}
                      className="btn btn-ghost"
                      style={{ justifyContent: 'space-between', padding: '10px 14px' }}
                    >
                      <span>{player!.name}</span>
                      <span className="badge badge-muted">Bench</span>
                    </button>
                  ))}
                </>
              )}

              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', marginTop: '6px' }}>
                <button
                  onClick={() => handleScoreHomeGoal(undefined)}
                  className="btn btn-secondary btn-block"
                >
                  Unassigned / Own Goal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. 1-to-1 Substitution Modal */}
      {showSubModal && (
        <div className="modal-overlay" onClick={() => setShowSubModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Substitute Player</h2>
              <button className="icon-button" onClick={() => setShowSubModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Player coming <strong>OFF</strong>:
              </div>
              <div
                style={{
                  background: 'var(--bg-surface)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 700,
                  fontSize: '1rem',
                  color: 'var(--danger-red)'
                }}
              >
                {playerMap.get(selectedPitchPlayerForSub || '')?.name || 'Selected Player'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Select Bench Player to bring <strong>ON</strong>:
              </div>

              {benchPlayers.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {benchPlayers.map((benchPlayer) => (
                    <button
                      key={benchPlayer!.id}
                      onClick={() => handleExecute1to1Sub(selectedPitchPlayerForSub!, benchPlayer!.id)}
                      className="btn btn-secondary"
                      style={{ justifyContent: 'space-between', padding: '12px 16px' }}
                    >
                      <span style={{ fontWeight: 700, color: 'var(--pitch-green-light)' }}>
                        {benchPlayer!.name}
                      </span>
                      <span className="badge badge-muted">
                        {getPlayerLiveMinutes(benchPlayer!.id)} played
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No available substitutes on bench.
                </div>
              )}

              {selectedPitchPlayerForSub && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px', marginTop: '14px' }}>
                  <button
                    type="button"
                    onClick={() => handleTakePlayerOff(selectedPitchPlayerForSub)}
                    className="btn btn-ghost btn-block"
                    style={{ color: 'var(--danger-red)', fontSize: '0.82rem' }}
                  >
                    Take Off without Replacement (Reduce player count)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick GK Swap Confirmation Modal */}
      {confirmGKSwapPlayerId && (
        <div className="modal-overlay" onClick={() => setConfirmGKSwapPlayerId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <GoalkeeperIcon size={22} color="var(--gk-gold)" />
                Swap to Goalkeeper
              </h2>
              <button className="icon-button" onClick={() => setConfirmGKSwapPlayerId(null)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ marginBottom: '20px', textAlign: 'center', padding: '10px 0' }}>
              <p style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '8px' }}>
                Make <strong style={{ color: 'var(--gk-gold)' }}>{playerMap.get(confirmGKSwapPlayerId)?.name}</strong> the Goalkeeper?
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {activeGK ? (
                  <>Current Goalkeeper <strong style={{ color: 'var(--pitch-green-light)' }}>{activeGK.name}</strong> will move to outfield.</>
                ) : (
                  'Will become active goalkeeper.'
                )}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setConfirmGKSwapPlayerId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-gold"
                style={{ flex: 2 }}
                onClick={() => {
                  handleSwapGK(confirmGKSwapPlayerId);
                  setConfirmGKSwapPlayerId(null);
                }}
              >
                Confirm GK Swap
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Bench Sub-In Picker Modal */}
      {benchSubTargetPlayerId && (
        <div className="modal-overlay" onClick={() => setBenchSubTargetPlayerId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Substitute Player On</h2>
              <button className="icon-button" onClick={() => setBenchSubTargetPlayerId(null)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Player coming <strong>ON</strong>:
              </div>
              <div
                style={{
                  background: 'var(--bg-surface)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 700,
                  fontSize: '1rem',
                  color: 'var(--pitch-green-light)'
                }}
              >
                {playerMap.get(benchSubTargetPlayerId)?.name}
              </div>
            </div>

            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Select player to come <strong>OFF</strong>:
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '55vh', overflowY: 'auto' }}>
              {activeOutfield.map((pitchPlayer) => (
                <button
                  key={pitchPlayer!.id}
                  onClick={() => {
                    handleExecute1to1Sub(pitchPlayer!.id, benchSubTargetPlayerId);
                    setBenchSubTargetPlayerId(null);
                  }}
                  className="btn btn-secondary"
                  style={{ justifyContent: 'space-between', padding: '12px 14px' }}
                >
                  <span style={{ fontWeight: 600 }}>{pitchPlayer!.name}</span>
                  <span className="badge badge-green tabular-nums">
                    <Clock size={10} /> {getPlayerLiveMinutes(pitchPlayer!.id)}
                  </span>
                </button>
              ))}

              {activeGK && (
                <button
                  onClick={() => {
                    handleExecute1to1Sub(activeGK.id, benchSubTargetPlayerId);
                    setBenchSubTargetPlayerId(null);
                  }}
                  className="btn btn-secondary"
                  style={{ justifyContent: 'space-between', padding: '12px 14px', borderColor: 'var(--gk-gold)' }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--gk-gold-light)' }}>
                    {activeGK.name} (GK)
                  </span>
                  <span className="badge badge-gold tabular-nums">
                    <Clock size={10} /> {getPlayerLiveMinutes(activeGK.id)}
                  </span>
                </button>
              )}

              {activePowerplay.map((pitchPlayer) => (
                <button
                  key={pitchPlayer!.id}
                  onClick={() => {
                    handleExecute1to1Sub(pitchPlayer!.id, benchSubTargetPlayerId);
                    setBenchSubTargetPlayerId(null);
                  }}
                  className="btn btn-secondary"
                  style={{ justifyContent: 'space-between', padding: '12px 14px', borderColor: 'var(--powerplay-purple)' }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--powerplay-purple)' }}>
                    {pitchPlayer!.name} (Extra Player)
                  </span>
                  <span className="badge badge-purple tabular-nums">
                    <Clock size={10} /> {getPlayerLiveMinutes(pitchPlayer!.id)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}


      {/* 3. Batch Substitution Modal */}
      {showBatchSubModal && (
        <div className="modal-overlay" onClick={() => setShowBatchSubModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Batch Substitutions</h2>
              <button className="icon-button" onClick={() => setShowBatchSubModal(false)}>
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Swap multiple players simultaneously in a single stoppage.
            </p>

            {/* Existing selected pairs */}
            {batchPairs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Pending Substitutions ({batchPairs.length}):
                </div>
                {batchPairs.map((pair, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'var(--bg-surface)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '0.85rem'
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--danger-red)' }}>{playerMap.get(pair.offId)?.name} OFF</span> →{' '}
                      <span style={{ color: 'var(--pitch-green-light)' }}>{playerMap.get(pair.onId)?.name} ON</span>
                    </div>
                    <button
                      onClick={() => setBatchPairs(batchPairs.filter((_, i) => i !== idx))}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Helper to add a pair */}
            <div className="card" style={{ background: 'var(--bg-surface)', padding: '12px' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '8px' }}>
                Add Player Swap
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Player OFF</label>
                  <select
                    id="batchOffSelect"
                    className="form-input"
                    style={{ minHeight: '38px', padding: '4px 8px', fontSize: '0.85rem' }}
                    defaultValue=""
                  >
                    <option value="" disabled>Select OFF</option>
                    {activeOutfield
                      .filter((p) => !batchPairs.some((bp) => bp.offId === p!.id))
                      .map((p) => (
                        <option key={p!.id} value={p!.id}>{p!.name}</option>
                      ))}
                    {activeGK && !batchPairs.some((bp) => bp.offId === activeGK.id) && (
                      <option value={activeGK.id}>{activeGK.name} (GK)</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Player ON</label>
                  <select
                    id="batchOnSelect"
                    className="form-input"
                    style={{ minHeight: '38px', padding: '4px 8px', fontSize: '0.85rem' }}
                    defaultValue=""
                  >
                    <option value="" disabled>Select ON</option>
                    {benchPlayers
                      .filter((p) => !batchPairs.some((bp) => bp.onId === p!.id))
                      .map((p) => (
                        <option key={p!.id} value={p!.id}>{p!.name}</option>
                      ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const offSelect = document.getElementById('batchOffSelect') as HTMLSelectElement;
                  const onSelect = document.getElementById('batchOnSelect') as HTMLSelectElement;
                  if (offSelect?.value && onSelect?.value) {
                    setBatchPairs([...batchPairs, { offId: offSelect.value, onId: onSelect.value }]);
                    offSelect.value = '';
                    onSelect.value = '';
                  }
                }}
                className="btn btn-secondary btn-block"
                style={{ minHeight: '34px', fontSize: '0.82rem' }}
              >
                + Add to Batch
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => {
                  setBatchPairs([]);
                  setShowBatchSubModal(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={batchPairs.length === 0}
                onClick={handleExecuteBatchSubs}
                className="btn btn-primary"
                style={{ flex: 2 }}
              >
                Confirm {batchPairs.length} Subs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Goalkeeper Swap Modal */}
      {showGKSwapModal && (
        <div className="modal-overlay" onClick={() => setShowGKSwapModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <GoalkeeperIcon size={22} color="var(--gk-gold)" />
                Rotate Goalkeeper
              </h2>
              <button className="icon-button" onClick={() => setShowGKSwapModal(false)}>
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Current GK: <strong style={{ color: 'var(--gk-gold)' }}>{activeGK?.name || 'None'}</strong>
              <br />
              Select who should take over as goalkeeper:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>From Outfield (Role Swap):</div>
              {activeOutfield.map((player) => (
                <button
                  key={player!.id}
                  onClick={() => handleSwapGK(player!.id)}
                  className="btn btn-secondary"
                  style={{ justifyContent: 'space-between', padding: '12px 16px' }}
                >
                  <span style={{ fontWeight: 700 }}>{player!.name}</span>
                  <span className="badge badge-gold">Swap with GK</span>
                </button>
              ))}

              {benchPlayers.length > 0 && (
                <>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                    From Bench (Replace GK):
                  </div>
                  {benchPlayers.map((player) => (
                    <button
                      key={player!.id}
                      onClick={() => handleSwapGK(player!.id)}
                      className="btn btn-ghost"
                      style={{ justifyContent: 'space-between', padding: '10px 14px' }}
                    >
                      <span>{player!.name}</span>
                      <span className="badge badge-muted">Bench</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. Player Count & Extra Players Modal */}
      {showPowerplayModal && (
        <div className="modal-overlay" onClick={() => setShowPowerplayModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">👥 Player Count & Extra Players</h2>
              <button className="icon-button" onClick={() => setShowPowerplayModal(false)}>
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Adjust pitch numbers on the fly — switch to 6-a-side, bring on an extra player by agreement, or apply the grassroots powerplay rule.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-surface)', padding: '10px 12px', borderRadius: 'var(--radius-md)', marginBottom: '14px', fontSize: '0.85rem' }}>
              <div>
                On Pitch: <strong style={{ color: 'var(--pitch-green-light)' }}>{activeOutfield.length + (activeGK ? 1 : 0) + activePowerplay.length} players</strong>
              </div>
              <span className="badge badge-muted">
                Format: {match.format}
              </span>
            </div>

            {/* Tab switch buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
              <button
                type="button"
                onClick={() => setExtraPlayerModalTab('add')}
                className={`btn ${extraPlayerModalTab === 'add' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.82rem', padding: '8px 6px' }}
              >
                + Bring On (+1)
              </button>
              <button
                type="button"
                onClick={() => setExtraPlayerModalTab('remove')}
                className={`btn ${extraPlayerModalTab === 'remove' ? 'btn-danger' : 'btn-secondary'}`}
                style={{ fontSize: '0.82rem', padding: '8px 6px' }}
              >
                - Withdraw (-1)
              </button>
            </div>

            {extraPlayerModalTab === 'add' ? (
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Select Bench Player to enter pitch:
                </div>

                {benchPlayers.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '50vh', overflowY: 'auto' }}>
                    {benchPlayers.map((player) => (
                      <button
                        key={player!.id}
                        onClick={() => handleAddPowerplayPlayer(player!.id, '6-a-side / Extra Player')}
                        className="btn btn-secondary"
                        style={{ justifyContent: 'space-between', padding: '12px 16px' }}
                      >
                        <span style={{ fontWeight: 700, color: 'var(--powerplay-purple)' }}>
                          {player!.name}
                        </span>
                        <span className="badge badge-purple">+ Bring On</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No available players on bench.
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Select Pitch Player to withdraw to bench (reduce numbers):
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '50vh', overflowY: 'auto' }}>
                  {activePowerplay.map((player) => (
                    <button
                      key={player!.id}
                      onClick={() => handleRemovePowerplayPlayer(player!.id)}
                      className="btn btn-secondary"
                      style={{ justifyContent: 'space-between', padding: '12px 16px', borderColor: 'var(--powerplay-purple)' }}
                    >
                      <div>
                        <span style={{ fontWeight: 700 }}>{player!.name}</span>{' '}
                        <span style={{ fontSize: '0.75rem', color: 'var(--powerplay-purple)' }}>(Extra Player)</span>
                      </div>
                      <span className="badge badge-red">Withdraw</span>
                    </button>
                  ))}

                  {activeOutfield.map((player) => (
                    <button
                      key={player!.id}
                      onClick={() => handleTakePlayerOff(player!.id)}
                      className="btn btn-secondary"
                      style={{ justifyContent: 'space-between', padding: '12px 16px' }}
                    >
                      <span style={{ fontWeight: 600 }}>{player!.name}</span>
                      <span className="badge badge-red">Withdraw</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. Live Match Events List Modal */}
      {showEventsModal && (
        <div className="modal-overlay" onClick={() => setShowEventsModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Match Event Log</h2>
              <button className="icon-button" onClick={() => setShowEventsModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '60vh', overflowY: 'auto' }}>
              {[...match.events].reverse().map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'var(--bg-surface)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {ev.type === 'goal_for' && `⚽ Goal - ${playerMap.get(ev.playerId || '')?.name || 'Team'}`}
                      {ev.type === 'goal_against' && `Goal Against - ${match.opposition}`}
                      {ev.type === 'substitution' && `Sub: ${playerMap.get(ev.playerId || '')?.name} ON / ${playerMap.get(ev.subOutPlayerId || '')?.name} OFF`}
                      {ev.type === 'gk_swap' && `GK: ${playerMap.get(ev.playerId || '')?.name} took goal`}
                      {ev.type === 'powerplay_in' && `Powerplay ON: ${playerMap.get(ev.playerId || '')?.name}`}
                      {ev.type === 'powerplay_out' && `Powerplay OFF: ${playerMap.get(ev.playerId || '')?.name}`}
                      {ev.type === 'period_start' && ev.notes}
                      {ev.type === 'period_end' && ev.notes}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {formatMMSS(ev.timestampSeconds)} • Period {ev.period}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 7. Next Period Confirmation Modal */}
      {showNextPeriodModal && (
        <div className="modal-overlay" onClick={() => setShowNextPeriodModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Start 2nd Half?</h2>
              <button className="icon-button" onClick={() => setShowNextPeriodModal(false)}>
                <X size={20} />
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '18px' }}>
              Advance to Period {match.currentPeriod + 1}. Current active lineup will continue into the next half.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setShowNextPeriodModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTransitionNextPeriod}
                className="btn btn-primary"
                style={{ flex: 2 }}
              >
                Start Next Half
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. End Match Modal */}
      {showEndMatchModal && (
        <div className="modal-overlay" onClick={() => setShowEndMatchModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">End Match?</h2>
              <button className="icon-button" onClick={() => setShowEndMatchModal(false)}>
                <X size={20} />
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '14px' }}>
              This will conclude the match at <strong>{match.scoreFor} - {match.scoreAgainst}</strong>, close all player pitch intervals, and generate the final match timeline report.
            </p>

            {/* Player of the Match Selection */}
            <div style={{ margin: '14px 0 18px 0', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                  <Star size={16} color="var(--gk-gold)" fill={selectedPotmId ? 'var(--gk-gold)' : 'none'} />
                  <span style={{ fontWeight: 700 }}>Player of the Match</span>
                </label>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Optional</span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '8px',
                  maxHeight: '160px',
                  overflowY: 'auto',
                  padding: '2px'
                }}
              >
                {(players || [])
                  .filter((p) => p.isActive)
                  .map((player) => {
                    const isSelected = selectedPotmId === player.id;
                    return (
                      <button
                        key={player.id}
                        type="button"
                        onClick={() => {
                          hapticFeedback.tap();
                          setSelectedPotmId(isSelected ? null : player.id);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-md)',
                          border: isSelected ? '1.5px solid var(--gk-gold)' : '1px solid var(--border-subtle)',
                          background: isSelected ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-surface)',
                          color: isSelected ? '#fff' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: isSelected ? 'var(--gk-gold)' : 'var(--bg-elevated)',
                            color: isSelected ? '#000' : 'var(--text-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            flexShrink: 0
                          }}
                        >
                          {isSelected ? <Star size={13} fill="#000" /> : player.name.charAt(0).toUpperCase()}
                        </div>
                        <span
                          style={{
                            fontSize: '0.82rem',
                            fontWeight: isSelected ? 700 : 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {player.name}
                        </span>
                      </button>
                    );
                  })}
              </div>

              {selectedPotmId && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', fontSize: '0.75rem', color: 'var(--gk-gold)' }}>
                  <span>Awarding POTM to: <strong>{playerMap.get(selectedPotmId)?.name}</strong> ⭐</span>
                  <button
                    type="button"
                    onClick={() => setSelectedPotmId(null)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {nextMatch && (
                <button
                  type="button"
                  onClick={() => handleEndMatch(true)}
                  className="btn btn-primary btn-block btn-lg"
                  style={{
                    fontWeight: 800,
                    fontSize: '0.98rem',
                    boxShadow: '0 4px 14px var(--pitch-green-glow)'
                  }}
                >
                  <Play size={18} fill="#000" />
                  Start Next Match: Game {nextMatch.matchGroupIndex || 2} vs {nextMatch.opposition}
                </button>
              )}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => setShowEndMatchModal(false)}
                >
                  Keep Playing
                </button>
                <button
                  type="button"
                  onClick={() => handleEndMatch(false)}
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                >
                  {nextMatch ? 'Finish & Report' : 'Finish & View Results'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 9. Rotation Schedule Modal */}
      {showScheduleModal && (
        <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={20} color="var(--pitch-green)" />
                Rotation Schedule
              </h2>
              <button className="icon-button" onClick={() => setShowScheduleModal(false)}>
                <X size={20} />
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '14px' }}>
              Planned rotations for this match to guarantee equal playing time.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto', marginBottom: '16px' }}>
              {/* Kickoff */}
              <div
                style={{
                  padding: '10px 12px',
                  background: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.82rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <strong style={{ color: 'var(--pitch-green-light)' }}>00:00 Kick-off (Starting Lineup)</strong>
                  <span style={{ fontSize: '0.72rem', color: 'var(--pitch-green)' }}>✓ Started</span>
                </div>
                <div style={{ color: 'var(--gk-gold)' }}>
                  🧤 GK: {playerMap.get(match.startingGoalkeeperId || '')?.name}
                </div>
                <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                  🏃 Pitch: {match.startingOutfieldPlayerIds.map((id) => playerMap.get(id)?.name).join(', ')}
                </div>
              </div>

              {/* Planned changes */}
              {(match.plannedSubstitutions || []).map((pSub) => {
                const isDue = !pSub.applied && !pSub.dismissed && currentSeconds >= pSub.timestampSeconds;

                return (
                  <div
                    key={pSub.id}
                    style={{
                      padding: '10px 12px',
                      background: isDue ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-surface)',
                      borderRadius: 'var(--radius-md)',
                      border: isDue ? '1.5px solid var(--pitch-green)' : '1px solid var(--border-subtle)',
                      fontSize: '0.82rem'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <strong style={{ color: isDue ? 'var(--pitch-green-light)' : '#fff' }}>
                        {pSub.label} (Period {pSub.period})
                      </strong>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          color: pSub.applied ? 'var(--pitch-green)' : isDue ? 'var(--pitch-green-light)' : 'var(--text-muted)'
                        }}
                      >
                        {pSub.applied ? '✓ Applied' : isDue ? '🔔 DUE NOW' : 'Upcoming'}
                      </span>
                    </div>

                    {pSub.gkChange && (
                      <div style={{ color: 'var(--gk-gold)', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <GoalkeeperIcon size={15} color="var(--gk-gold)" />
                        <span>GK: {playerMap.get(pSub.gkChange.inPlayerId)?.name} replaces {playerMap.get(pSub.gkChange.outPlayerId || '')?.name}</span>
                      </div>
                    )}

                    {pSub.outfieldChanges.map((chg, cIdx) => (
                      <div key={cIdx} style={{ color: 'var(--text-primary)' }}>
                        🔄 {playerMap.get(chg.inPlayerId)?.name} ON ↔️ {playerMap.get(chg.outPlayerId)?.name} OFF
                      </div>
                    ))}

                    {isDue && (
                      <button
                        type="button"
                        onClick={() => {
                          handleApplyPlannedSub(pSub);
                          setShowScheduleModal(false);
                        }}
                        className="btn btn-primary btn-block"
                        style={{ marginTop: '8px', minHeight: '36px', fontSize: '0.82rem' }}
                      >
                        Apply Changes Now
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => setShowScheduleModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
