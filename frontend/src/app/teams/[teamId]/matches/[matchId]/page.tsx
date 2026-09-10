'use client';

import React, { useState, useEffect, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, generateUUID } from '@/db';
import type { Match, MatchEvent, PlayerMatchStint } from '@/db/schema';
import { Navbar } from '@/components/Navbar';
import { sound } from '@/utils/audio';
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
  SunMedium
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

  // Local tick counter to trigger re-renders every 1s while running
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const whistlePlayedForPeriodRef = useRef<number | null>(null);

  // Modals
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showSubModal, setShowSubModal] = useState(false);
  const [selectedPitchPlayerForSub, setSelectedPitchPlayerForSub] = useState<string | null>(null);
  const [showBatchSubModal, setShowBatchSubModal] = useState(false);
  const [showGKSwapModal, setShowGKSwapModal] = useState(false);
  const [showPowerplayModal, setShowPowerplayModal] = useState(false);
  const [showEventsModal, setShowEventsModal] = useState(false);
  const [showEndMatchModal, setShowEndMatchModal] = useState(false);
  const [showNextPeriodModal, setShowNextPeriodModal] = useState(false);

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
      // Resume / Start timer
      await db.matches.update(matchId, {
        status: 'in_progress',
        lastStartedAt: now
      });
    }
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

      // Update rosters
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

  // --- Powerplay Rules (+1 Extra Player) ---
  const handleAddPowerplayPlayer = async (playerId: string) => {
    hapticFeedback.tap();
    const now = Date.now();
    const currentSecs = currentSeconds;

    // Add stint for powerplay player
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

    const newEvent: MatchEvent = {
      id: generateUUID(),
      matchId,
      type: 'powerplay_in',
      timestampSeconds: currentSecs,
      period: match.currentPeriod,
      playerId,
      notes: 'Powerplay extra player added',
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

    const newEvent: MatchEvent = {
      id: generateUUID(),
      matchId,
      type: 'powerplay_out',
      timestampSeconds: currentSecs,
      period: match.currentPeriod,
      playerId,
      notes: 'Powerplay player removed',
      createdAt: now
    };

    await db.matches.update(matchId, {
      activePowerplayPlayerIds: newPowerplay,
      benchPlayerIds: newBench,
      stints: updatedStints,
      events: [...match.events, newEvent]
    });
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

  // --- End Match Handler ---
  const handleEndMatch = async () => {
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
      completedAt: now
    });

    setShowEndMatchModal(false);
    router.push(`/teams/${teamId}/results/${matchId}`);
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

  // Active pitch rosters
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

  return (
    <>
      <Navbar
        showBack
        backHref={`/teams/${teamId}`}
        title={`${team.name} vs ${match.opposition}`}
        subtitle={`${match.format} • ${match.currentPeriod === 1 ? '1st Half' : match.currentPeriod === 2 ? '2nd Half' : `Period ${match.currentPeriod}`}`}
        rightAction={
          <button
            onClick={() => setShowEndMatchModal(true)}
            className="btn btn-danger"
            style={{ minHeight: '34px', padding: '4px 10px', fontSize: '0.8rem' }}
          >
            End Match
          </button>
        }
      />

      <main className="main-content" style={{ paddingBottom: '90px' }}>
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
              <span className="badge badge-green">
                {match.currentPeriod === 1 ? '1ST HALF' : match.currentPeriod === 2 ? '2ND HALF' : `PERIOD ${match.currentPeriod}`}
              </span>
              <span className="wake-lock-active" title="Screen kept awake">
                <SunMedium size={14} /> Screen Awake
              </span>
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
              color: isRunning ? 'var(--pitch-green-light)' : 'var(--text-secondary)',
              textShadow: isRunning ? '0 0 20px var(--pitch-green-glow)' : 'none'
            }}
          >
            {formatMMSS(currentSeconds)}
          </div>

          {/* Clock Control Buttons */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '16px' }}>
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
                  <Play size={20} fill="#000" /> Start Timer
                </>
              )}
            </button>

            {/* Next Period Trigger */}
            {match.currentPeriod < match.targetPeriods && (
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

        {/* Tactical Controls Bar (Batch Subs, Swap GK, Powerplay, History) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '16px' }}>
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
            <Shield size={16} color="var(--gk-gold)" />
            Swap GK
          </button>

          <button
            onClick={() => setShowPowerplayModal(true)}
            className="btn btn-secondary"
            style={{ flexDirection: 'column', minHeight: '52px', padding: '6px 4px', fontSize: '0.72rem', gap: '3px' }}
          >
            <Zap size={16} color="var(--powerplay-purple)" />
            Powerplay
          </button>

          <button
            onClick={() => setShowEventsModal(true)}
            className="btn btn-secondary"
            style={{ flexDirection: 'column', minHeight: '52px', padding: '6px 4px', fontSize: '0.72rem', gap: '3px' }}
          >
            <History size={16} color="var(--text-muted)" />
            Events ({match.events.length})
          </button>
        </div>

        {/* Live Pitch Lineup Section */}
        <div className="card" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--pitch-green)' }} />
              On Pitch ({activeOutfield.length + (activeGK ? 1 : 0) + activePowerplay.length})
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Tap player to substitute
            </div>
          </div>

          {/* Goalkeeper Card */}
          {activeGK && (
            <div
              onClick={() => {
                setSelectedPitchPlayerForSub(activeGK.id);
                setShowSubModal(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1.5px solid var(--gk-gold)',
                marginBottom: '8px',
                cursor: 'pointer'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                    justifyContent: 'center'
                  }}
                >
                  GK
                </div>
                <div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {activeGK.name}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--gk-gold-light)' }}>
                    Goalkeeper
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="badge badge-gold tabular-nums">
                  <Clock size={12} /> {getPlayerLiveMinutes(activeGK.id)}
                </span>
                <ArrowRightLeft size={16} color="var(--gk-gold)" />
              </div>
            </div>
          )}

          {/* Outfield Starters Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {activeOutfield.map((player) => (
              <div
                key={player!.id}
                onClick={() => {
                  setSelectedPitchPlayerForSub(player!.id);
                  setShowSubModal(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  transition: 'background 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                      justifyContent: 'center'
                    }}
                  >
                    {player!.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {player!.name}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="badge badge-green tabular-nums">
                    <Clock size={12} /> {getPlayerLiveMinutes(player!.id)}
                  </span>
                  <ArrowRightLeft size={16} color="var(--text-muted)" />
                </div>
              </div>
            ))}

            {/* Powerplay extra players */}
            {activePowerplay.map((player) => (
              <div
                key={player!.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(168, 85, 247, 0.12)',
                  border: '1.5px solid var(--powerplay-purple)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                      justifyContent: 'center'
                    }}
                  >
                    +1
                  </div>
                  <div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {player!.name}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--powerplay-purple)' }}>
                      Powerplay Extra Player
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="badge badge-purple tabular-nums">
                    <Clock size={12} /> {getPlayerLiveMinutes(player!.id)}
                  </span>
                  <button
                    onClick={() => handleRemovePowerplayPlayer(player!.id)}
                    className="btn btn-ghost"
                    style={{ minHeight: '30px', padding: '4px 8px', fontSize: '0.75rem', color: 'var(--danger-red)' }}
                    title="Remove powerplay player"
                  >
                    Off
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
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                    {player!.name}
                  </div>
                  <span className="badge badge-muted tabular-nums">
                    {getPlayerLiveMinutes(player!.id)} played
                  </span>
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
                  {lastEvent.type === 'gk_swap' && `GK Swap: ${playerMap.get(lastEvent.playerId || '')?.name} in goal`}
                  {lastEvent.type === 'powerplay_in' && `Powerplay: ${playerMap.get(lastEvent.playerId || '')?.name} ON`}
                  {lastEvent.type === 'powerplay_out' && `Powerplay: ${playerMap.get(lastEvent.playerId || '')?.name} OFF`}
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
              <h2 className="modal-title">Rotate Goalkeeper</h2>
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

      {/* 5. Powerplay Modal */}
      {showPowerplayModal && (
        <div className="modal-overlay" onClick={() => setShowPowerplayModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Powerplay Rule</h2>
              <button className="icon-button" onClick={() => setShowPowerplayModal(false)}>
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              In grassroots football, a team trailing by 4+ goals may bring on an extra player without removing anyone.
            </p>

            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Select Bench Player to Bring On:
              </div>

              {benchPlayers.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {benchPlayers.map((player) => (
                    <button
                      key={player!.id}
                      onClick={() => handleAddPowerplayPlayer(player!.id)}
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
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No available players on bench.
                </div>
              )}
            </div>
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
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '18px' }}>
              This will conclude the match at <strong>{match.scoreFor} - {match.scoreAgainst}</strong>, close all player pitch intervals, and generate the final match timeline report.
            </p>
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
                onClick={handleEndMatch}
                className="btn btn-danger"
                style={{ flex: 2 }}
              >
                Finish & View Results
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
