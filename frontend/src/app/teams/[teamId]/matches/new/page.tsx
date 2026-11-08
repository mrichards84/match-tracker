'use client';

import React, { useState, use, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, generateUUID } from '@/db';
import type { MatchFormat, PlayerMatchStint, Match } from '@/db/schema';
import { Navbar } from '@/components/Navbar';
import { GoalkeeperIcon } from '@/components/GoalkeeperIcon';
import { formatTimeShort } from '@/utils/formatters';
import { getMatchPitchCount, calculateTargetPitchSeconds } from '@/utils/targetTime';
import {
  Users,
  Play,
  Clock,
  CheckCircle,
  AlertCircle,
  Plus,
  Trash2,
  Calendar,
  Info,
  Layers,
  Sparkles,
  Check
} from 'lucide-react';
import { hapticFeedback } from '@/utils/haptics';

interface FormatPreset {
  id: MatchFormat;
  label: string;
  defaultOutfield: number;
  totalOnPitch: number;
}

const FORMAT_PRESETS: FormatPreset[] = [
  { id: '3v3', label: '3v3', defaultOutfield: 2, totalOnPitch: 3 },
  { id: '5v5', label: '5v5', defaultOutfield: 4, totalOnPitch: 5 },
  { id: '7v7', label: '7v7', defaultOutfield: 6, totalOnPitch: 7 },
  { id: '9v9', label: '9v9', defaultOutfield: 8, totalOnPitch: 9 },
  { id: '11v11', label: '11v11', defaultOutfield: 10, totalOnPitch: 11 },
  { id: 'custom', label: 'Custom', defaultOutfield: 4, totalOnPitch: 5 }
];

interface ConfiguredMatch {
  id: string; // temporary local id
  opposition: string;
  targetPeriods: number; // e.g. 2 halves
  periodDurationMinutes: number; // e.g. 20 mins
  startingGoalkeeperId?: string; // optional starting GK
}

export default function MatchSetupPage({
  params
}: {
  params: Promise<{ teamId: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const teamId = resolvedParams.teamId;

  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const allActivePlayers = useLiveQuery(
    () => db.players.where('teamId').equals(teamId).and((p) => p.isActive).toArray(),
    [teamId]
  );

  // --- Step 1: Matchday Squad Attendance ---
  const [attendingPlayerIds, setAttendingPlayerIds] = useState<string[]>([]);
  const [attendanceInitialized, setAttendanceInitialized] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [isDraftRestored, setIsDraftRestored] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  // --- Step 2: Matches to Play ---
  const [matchesList, setMatchesList] = useState<ConfiguredMatch[]>([
    {
      id: generateUUID(),
      opposition: '',
      targetPeriods: 2,
      periodDurationMinutes: 20
    }
  ]);

  // --- Step 3: Game Format & Pitch Count ---
  const [format, setFormat] = useState<MatchFormat>('7v7');
  const [customPlayersOnPitch, setCustomPlayersOnPitch] = useState<number>(7);

  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 1. Auto-Restore Draft from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`matchday_draft_${teamId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        let restoredAny = false;

        if (Array.isArray(parsed.attendingPlayerIds) && parsed.attendingPlayerIds.length > 0) {
          setAttendingPlayerIds(parsed.attendingPlayerIds);
          setAttendanceInitialized(true);
          restoredAny = true;
        }
        if (Array.isArray(parsed.matchesList) && parsed.matchesList.length > 0) {
          setMatchesList(parsed.matchesList);
          restoredAny = true;
        }
        if (parsed.format) {
          setFormat(parsed.format);
          restoredAny = true;
        }
        if (typeof parsed.customPlayersOnPitch === 'number') {
          setCustomPlayersOnPitch(parsed.customPlayersOnPitch);
        }

        if (restoredAny) {
          setIsDraftRestored(true);
          if (parsed.savedAt) {
            setLastSavedTime(
              new Date(parsed.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            );
          }
        }
      }
    } catch (err) {
      console.warn('Failed to parse matchday draft from storage:', err);
    } finally {
      setDraftLoaded(true);
    }
  }, [teamId]);

  // 2. Default all active players to attending if NO draft exists
  useEffect(() => {
    if (!draftLoaded) return;
    if (!isDraftRestored && allActivePlayers && allActivePlayers.length > 0 && !attendanceInitialized) {
      setAttendingPlayerIds(allActivePlayers.map((p) => p.id));
      setAttendanceInitialized(true);
    }
  }, [draftLoaded, isDraftRestored, allActivePlayers, attendanceInitialized]);

  // 3. Auto-Save draft to localStorage whenever form values change
  useEffect(() => {
    if (!draftLoaded) return;
    try {
      const draft = {
        teamId,
        attendingPlayerIds,
        matchesList,
        format,
        customPlayersOnPitch,
        savedAt: Date.now()
      };
      localStorage.setItem(`matchday_draft_${teamId}`, JSON.stringify(draft));
      setLastSavedTime(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    } catch (err) {
      console.warn('Failed to save matchday draft:', err);
    }
  }, [
    draftLoaded,
    teamId,
    attendingPlayerIds,
    matchesList,
    format,
    customPlayersOnPitch
  ]);

  // Handle manual draft reset
  const handleResetDraft = () => {
    hapticFeedback.tap();
    if (!window.confirm('Reset all matchday setup inputs to defaults?')) return;
    try {
      localStorage.removeItem(`matchday_draft_${teamId}`);
    } catch {}
    setIsDraftRestored(false);
    if (allActivePlayers && allActivePlayers.length > 0) {
      setAttendingPlayerIds(allActivePlayers.map((p) => p.id));
    } else {
      setAttendingPlayerIds([]);
    }
    setMatchesList([
      {
        id: generateUUID(),
        opposition: '',
        targetPeriods: 2,
        periodDurationMinutes: 20
      }
    ]);
    setFormat('7v7');
    setCustomPlayersOnPitch(7);
    setErrorMsg('');
  };

  // Active Preset & Pitch count
  const activePreset = FORMAT_PRESETS.find((p) => p.id === format) || FORMAT_PRESETS[2];
  const playersOnPitch = getMatchPitchCount(format, customPlayersOnPitch);
  const squadSize = attendingPlayerIds.length;

  // Map for quick player lookups
  const playerMap = useMemo(() => {
    const map = new Map<string, string>();
    (allActivePlayers || []).forEach((p) => map.set(p.id, p.name));
    return map;
  }, [allActivePlayers]);

  // Toggle Attendance
  const handleToggleAttendance = (playerId: string) => {
    hapticFeedback.tap();
    setErrorMsg('');
    setAttendingPlayerIds((prev) => {
      if (prev.includes(playerId)) {
        return prev.filter((id) => id !== playerId);
      } else {
        return [...prev, playerId];
      }
    });
  };

  const handleSelectAllAttendance = () => {
    hapticFeedback.tap();
    if (allActivePlayers) {
      setAttendingPlayerIds(allActivePlayers.map((p) => p.id));
    }
  };

  const handleClearAttendance = () => {
    hapticFeedback.tap();
    setAttendingPlayerIds([]);
  };

  // Match List actions
  const handleAddMatch = () => {
    hapticFeedback.tap();
    setMatchesList((prev) => [
      ...prev,
      {
        id: generateUUID(),
        opposition: '',
        targetPeriods: prev[prev.length - 1]?.targetPeriods || 2,
        periodDurationMinutes: prev[prev.length - 1]?.periodDurationMinutes || 20,
        startingGoalkeeperId: undefined
      }
    ]);
  };

  const handleRemoveMatch = (index: number) => {
    hapticFeedback.tap();
    if (matchesList.length <= 1) return;
    setMatchesList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateMatch = (index: number, updates: Partial<ConfiguredMatch>) => {
    setMatchesList((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...updates } : m))
    );
  };

  // Calculations for playing time based on squad size and number on pitch
  const matchDurationMins = (matchesList[0]?.targetPeriods || 2) * (matchesList[0]?.periodDurationMinutes || 20);
  const matchTotalSeconds = matchDurationMins * 60;

  const targetPlayingSecondsPerMatch = calculateTargetPitchSeconds({
    targetPeriods: matchesList[0]?.targetPeriods || 2,
    periodDurationMinutes: matchesList[0]?.periodDurationMinutes || 20,
    squadSize,
    playersOnPitch
  });

  const totalMatchdayMins = matchesList.reduce(
    (sum, m) => sum + m.targetPeriods * m.periodDurationMinutes,
    0
  );

  const totalMatchdaySeconds = totalMatchdayMins * 60;
  const targetPlayingSecondsTotal =
    squadSize > 0
      ? squadSize <= playersOnPitch
        ? totalMatchdaySeconds
        : Math.round((playersOnPitch * totalMatchdaySeconds) / squadSize)
      : 0;

  const benchSecondsPerMatch = Math.max(0, matchTotalSeconds - targetPlayingSecondsPerMatch);
  const playingPercentage =
    matchTotalSeconds > 0
      ? Math.min(100, Math.round((targetPlayingSecondsPerMatch / matchTotalSeconds) * 100))
      : 0;

  // Validation & Submit
  const handleStartMatchday = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (attendingPlayerIds.length === 0) {
      setErrorMsg('Please select at least 1 player in the matchday squad.');
      return;
    }

    if (matchesList.some((m) => !m.opposition.trim())) {
      setErrorMsg('Please enter an opposition team name for all matches.');
      return;
    }

    setIsSubmitting(true);
    hapticFeedback.tap();

    try {
      const matchGroupId = generateUUID();
      const now = Date.now();
      const todayIso = new Date().toISOString().split('T')[0];

      // Pre-generate UUIDs for all matches in the group so we can link them
      const matchIds = matchesList.map(() => generateUUID());

      // Prepare database match records
      const dbMatches: Match[] = matchesList.map((mItem, idx) => {
        const matchId = matchIds[idx];
        const isFirstMatch = idx === 0;
        const nextMatchId = idx < matchIds.length - 1 ? matchIds[idx + 1] : undefined;
        const previousMatchId = idx > 0 ? matchIds[idx - 1] : undefined;

        // Calculate target seconds specifically for this match
        const thisMatchTargetSeconds = calculateTargetPitchSeconds({
          targetPeriods: mItem.targetPeriods,
          periodDurationMinutes: mItem.periodDurationMinutes,
          squadSize,
          playersOnPitch
        });

        // Determine starting lineup for this match
        // Designated starting GK or first player in attending squad
        const startingGkId =
          mItem.startingGoalkeeperId && attendingPlayerIds.includes(mItem.startingGoalkeeperId)
            ? mItem.startingGoalkeeperId
            : attendingPlayerIds[0];

        // Outfield players up to playersOnPitch - 1 (excluding GK)
        const eligibleOutfield = attendingPlayerIds.filter((id) => id !== startingGkId);
        const outfieldTargetCount = Math.max(0, playersOnPitch - (startingGkId ? 1 : 0));
        const startingOutfieldIds = eligibleOutfield.slice(0, outfieldTargetCount);
        const benchPlayerIds = eligibleOutfield.slice(outfieldTargetCount);

        // Build initial stints for Match 1
        const initialStints: PlayerMatchStint[] = [];
        if (isFirstMatch) {
          if (startingGkId) {
            initialStints.push({
              playerId: startingGkId,
              role: 'goalkeeper',
              startSecond: 0
            });
          }
          startingOutfieldIds.forEach((pId) => {
            initialStints.push({
              playerId: pId,
              role: 'outfield',
              startSecond: 0
            });
          });
        }

        return {
          id: matchId,
          teamId,
          opposition: mItem.opposition.trim(),
          date: todayIso,
          format,
          targetPeriods: mItem.targetPeriods,
          periodDurationMinutes: mItem.periodDurationMinutes,
          currentPeriod: 1,
          status: 'setup',
          elapsedSeconds: 0,
          lastStartedAt: undefined,
          scoreFor: 0,
          scoreAgainst: 0,

          // Multi-match linkage
          matchGroupId,
          matchGroupIndex: idx + 1,
          matchGroupTotal: matchesList.length,
          nextMatchId,
          previousMatchId,

          // Squad & playing time targets
          matchdaySquadPlayerIds: attendingPlayerIds,
          plannedGkPlayerIds: startingGkId ? [startingGkId] : [],
          plannedSubstitutions: [], // Substitutions are made flexibly during the match

          playersOnPitch,
          customPlayersOnPitch: format === 'custom' ? customPlayersOnPitch : undefined,
          targetPlayerPitchSeconds: thisMatchTargetSeconds,

          // Starting lineup
          startingGoalkeeperId: startingGkId,
          startingOutfieldPlayerIds: startingOutfieldIds,
          benchPlayerIds,

          // Live lineup
          activeGoalkeeperId: isFirstMatch ? startingGkId : undefined,
          activeOutfieldPlayerIds: isFirstMatch ? startingOutfieldIds : [],
          activePowerplayPlayerIds: [],

          stints: initialStints,
          events: [],
          createdAt: now
        };
      });

      // Save all matches to Dexie in a single atomic transaction
      await db.transaction('rw', db.matches, async () => {
        for (const m of dbMatches) {
          await db.matches.add(m);
        }
      });

      // Clear draft from localStorage since matchday has been officially created
      try {
        localStorage.removeItem(`matchday_draft_${teamId}`);
      } catch {}

      // Navigate straight to Match 1 live tracking page
      router.push(`/teams/${teamId}/matches/${matchIds[0]}`);
    } catch (err) {
      console.error('Failed to create matchday:', err);
      setErrorMsg('Error creating match session. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Navbar
        showBack
        backHref={`/teams/${teamId}`}
        title="Matchday Setup"
        subtitle={team?.name}
      />

      <main className="main-content" style={{ paddingBottom: '90px' }}>
        <form onSubmit={handleStartMatchday}>
          {/* Header Banner */}
          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, #131c2a 0%, #172436 100%)',
              border: '1px solid var(--border-subtle)',
              marginBottom: '16px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    background: 'var(--pitch-green-glow)',
                    border: '1px solid var(--pitch-green)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--pitch-green)',
                    flexShrink: 0
                  }}
                >
                  <Sparkles size={22} />
                </div>
                <div>
                  <h1 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                    Matchday Setup
                  </h1>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                    Set up opposition, match duration, squad attendance & pitch format.
                  </p>
                </div>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    color: 'var(--pitch-green-light)',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: '10px'
                  }}
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: 'var(--pitch-green)',
                      boxShadow: '0 0 6px var(--pitch-green)'
                    }}
                  />
                  Auto-saved
                </div>
              </div>
            </div>

            {/* Restored Draft Banner */}
            {isDraftRestored && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(14, 165, 233, 0.12)',
                  border: '1px solid rgba(14, 165, 233, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  fontSize: '0.8rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--sub-blue)' }}>
                  <CheckCircle size={14} />
                  <span>Draft restored from your previous visit{lastSavedTime ? ` (${lastSavedTime})` : ''}</span>
                </div>
                <button
                  type="button"
                  onClick={handleResetDraft}
                  className="btn btn-ghost"
                  style={{ minHeight: '24px', padding: '2px 8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}
                >
                  Reset Form
                </button>
              </div>
            )}
          </div>

          {/* Section 1: Matchday Squad Attendance */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={18} color="var(--pitch-green)" />
                <span>1. Matchday Squad Attendance</span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={handleSelectAllAttendance}
                  className="btn btn-ghost"
                  style={{ minHeight: '30px', padding: '3px 8px', fontSize: '0.75rem' }}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={handleClearAttendance}
                  className="btn btn-ghost"
                  style={{ minHeight: '30px', padding: '3px 8px', fontSize: '0.75rem' }}
                >
                  Clear
                </button>
              </div>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Select who turned up today. ({attendingPlayerIds.length} of {allActivePlayers?.length || 0} attending)
            </p>

            {allActivePlayers && allActivePlayers.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: '8px'
                }}
              >
                {allActivePlayers.map((player) => {
                  const isAttending = attendingPlayerIds.includes(player.id);
                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => handleToggleAttendance(player.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-md)',
                        background: isAttending ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-surface)',
                        border: isAttending ? '1.5px solid var(--pitch-green)' : '1px solid var(--border-subtle)',
                        color: isAttending ? '#fff' : 'var(--text-muted)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div
                        style={{
                          width: '26px',
                          height: '26px',
                          borderRadius: '50%',
                          background: isAttending ? 'var(--pitch-green)' : 'var(--bg-elevated)',
                          color: isAttending ? '#000' : 'var(--text-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          flexShrink: 0
                        }}
                      >
                        {isAttending ? <Check size={14} strokeWidth={3} /> : player.name.charAt(0).toUpperCase()}
                      </div>
                      <span
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: isAttending ? 700 : 500,
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
            ) : (
              <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-secondary)' }}>
                No active players in squad. Add players to the team first.
              </div>
            )}
          </div>

          {/* Section 2: Matches & Opposition Configuration */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={18} color="var(--sub-blue)" />
                <span>2. Matches & Opposition</span>
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Total: <strong>{totalMatchdayMins} mins</strong> ({matchesList.length} game{matchesList.length === 1 ? '' : 's'})
              </span>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
              Set up one or more matches. Match duration and periods are configured independently for each game.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {matchesList.map((matchItem, idx) => {
                const matchTotalMins = matchItem.targetPeriods * matchItem.periodDurationMinutes;
                return (
                  <div
                    key={matchItem.id}
                    style={{
                      background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-md)',
                      padding: '14px',
                      border: '1px solid var(--border-subtle)',
                      position: 'relative'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '10px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            background: 'var(--bg-elevated)',
                            color: 'var(--pitch-green)',
                            fontWeight: 800,
                            fontSize: '0.75rem',
                            padding: '3px 8px',
                            borderRadius: 'var(--radius-sm)'
                          }}
                        >
                          Game {idx + 1}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {matchTotalMins} mins ({matchItem.targetPeriods} x {matchItem.periodDurationMinutes}m)
                        </span>
                      </div>

                      {matchesList.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMatch(idx)}
                          className="icon-button"
                          style={{ color: 'var(--danger-red)', width: '30px', height: '30px' }}
                          aria-label={`Remove Game ${idx + 1}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>

                    {/* Opposition Input */}
                    <div className="form-group" style={{ marginBottom: '10px' }}>
                      <label className="form-label" style={{ fontSize: '0.82rem' }}>
                        Opposition Team Name *
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder={idx === 0 ? 'e.g. Redbridge Rovers' : `e.g. Opponent ${idx + 1}`}
                        value={matchItem.opposition}
                        onChange={(e) => handleUpdateMatch(idx, { opposition: e.target.value })}
                        required
                        style={{ minHeight: '44px' }}
                      />
                    </div>

                    {/* Periods & Length */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>
                          Periods
                        </label>
                        <select
                          className="form-input"
                          value={matchItem.targetPeriods}
                          onChange={(e) =>
                            handleUpdateMatch(idx, { targetPeriods: Number(e.target.value) })
                          }
                          style={{ minHeight: '40px', fontSize: '0.85rem' }}
                        >
                          <option value={1}>1 Single Period</option>
                          <option value={2}>2 Halves</option>
                          <option value={4}>4 Quarters</option>
                        </select>
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>
                          Period Length
                        </label>
                        <select
                          className="form-input"
                          value={matchItem.periodDurationMinutes}
                          onChange={(e) =>
                            handleUpdateMatch(idx, { periodDurationMinutes: Number(e.target.value) })
                          }
                          style={{ minHeight: '40px', fontSize: '0.85rem' }}
                        >
                          <option value={5}>5 mins</option>
                          <option value={6}>6 mins</option>
                          <option value={8}>8 mins</option>
                          <option value={10}>10 mins</option>
                          <option value={12}>12 mins</option>
                          <option value={15}>15 mins</option>
                          <option value={20}>20 mins</option>
                          <option value={25}>25 mins</option>
                          <option value={30}>30 mins</option>
                          <option value={35}>35 mins</option>
                          <option value={40}>40 mins</option>
                        </select>
                      </div>
                    </div>

                    {/* Optional Starting Goalkeeper */}
                    <div className="form-group" style={{ marginTop: '10px', marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <GoalkeeperIcon size={16} color="var(--gk-gold)" />
                        <span>Starting Goalkeeper (Optional)</span>
                      </label>
                      <select
                        className="form-input"
                        value={matchItem.startingGoalkeeperId || ''}
                        onChange={(e) =>
                          handleUpdateMatch(idx, { startingGoalkeeperId: e.target.value || undefined })
                        }
                        style={{ minHeight: '40px', fontSize: '0.85rem' }}
                      >
                        <option value="">Auto (First player on pitch starts in goal)</option>
                        {attendingPlayerIds.map((pId) => (
                          <option key={pId} value={pId}>
                            {playerMap.get(pId) || 'Player'}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add Another Match Button */}
            <button
              type="button"
              onClick={handleAddMatch}
              className="btn btn-secondary btn-block"
              style={{
                marginTop: '12px',
                borderStyle: 'dashed',
                minHeight: '42px',
                fontSize: '0.88rem'
              }}
            >
              <Plus size={18} />
              Add Another Match (Tournament / Double-Header)
            </button>
          </div>

          {/* Section 3: Game Format & Pitch Count */}
          <div className="card">
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Layers size={18} color="var(--powerplay-purple)" />
              <span>3. Pitch Format</span>
            </div>

            {/* Match Format Selector */}
            <div className="form-group" style={{ marginBottom: format === 'custom' ? '12px' : 0 }}>
              <label className="form-label" style={{ fontSize: '0.82rem' }}>
                Match Format (Pitch Size)
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {FORMAT_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setFormat(p.id);
                      hapticFeedback.tap();
                    }}
                    className={`btn ${format === p.id ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ minHeight: '40px', padding: '6px 8px', fontSize: '0.85rem' }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom pitch players if format is custom */}
            {format === 'custom' && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Players On Pitch (Total including GK)</label>
                <input
                  type="number"
                  min={2}
                  max={11}
                  className="form-input"
                  value={customPlayersOnPitch}
                  onChange={(e) => setCustomPlayersOnPitch(Math.max(2, Number(e.target.value)))}
                />
              </div>
            )}
          </div>

          {/* Section 4: Target Playing Time per Player across the Matchday */}
          {squadSize > 0 && (
            <div className="card" style={{ border: '1.5px solid var(--border-strong)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock size={18} color="var(--pitch-green)" />
                  <span>4. Target Playing Time</span>
                </div>
                <span
                  style={{
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: 'var(--pitch-green-light)',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-full)'
                  }}
                >
                  {matchesList.length > 1
                    ? `~${formatTimeShort(targetPlayingSecondsTotal)} total across ${matchesList.length} games`
                    : `~${formatTimeShort(targetPlayingSecondsPerMatch)} / player`}
                </span>
              </div>

              {/* Stat badges summary */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px',
                  marginBottom: '14px'
                }}
              >
                <div
                  style={{
                    background: 'var(--bg-surface)',
                    padding: '10px 8px',
                    borderRadius: 'var(--radius-sm)',
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {matchesList.length > 1 ? 'Day Target Pitch Time' : 'Target Pitch Time'}
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--pitch-green-light)' }}>
                    {formatTimeShort(matchesList.length > 1 ? targetPlayingSecondsTotal : targetPlayingSecondsPerMatch)}
                  </div>
                  {matchesList.length > 1 && (
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      (~{formatTimeShort(targetPlayingSecondsPerMatch)} / game)
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: 'var(--bg-surface)',
                    padding: '10px 8px',
                    borderRadius: 'var(--radius-sm)',
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {matchesList.length > 1 ? 'Total Day Match Time' : 'Total Match Time'}
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--sub-blue)' }}>
                    {totalMatchdayMins}m
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {matchesList.length > 1 ? `${matchesList.length} games total` : '1 game'}
                  </div>
                </div>

                <div
                  style={{
                    background: 'var(--bg-surface)',
                    padding: '10px 8px',
                    borderRadius: 'var(--radius-sm)',
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Bench Rest Time</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                    {formatTimeShort(
                      matchesList.length > 1
                        ? totalMatchdaySeconds - targetPlayingSecondsTotal
                        : benchSecondsPerMatch
                    )}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {matchesList.length > 1 ? 'across day' : 'per game'}
                  </div>
                </div>
              </div>

              {/* Explanatory Banner */}
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-surface)',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  border: '1px solid var(--border-subtle)',
                  lineHeight: 1.4
                }}
              >
                <Info size={16} color="var(--sub-blue)" style={{ flexShrink: 0 }} />
                <span>
                  {matchesList.length > 1 ? (
                    <>
                      Across <strong>{matchesList.length} matches ({totalMatchdayMins} mins total)</strong> with a <strong>{squadSize}-player squad</strong> and <strong>{playersOnPitch} on the pitch</strong>, each player should roughly play <strong>{formatTimeShort(targetPlayingSecondsTotal)}</strong> across the day (~{formatTimeShort(targetPlayingSecondsPerMatch)} per game). During the matches, live playing time counters will track cumulative time across the whole day so you can balance pitch time across all games.
                    </>
                  ) : squadSize <= playersOnPitch ? (
                    <>
                      With a squad of <strong>{squadSize}</strong> and <strong>{playersOnPitch}</strong> on the pitch, every player can play the full <strong>{matchDurationMins} minutes</strong>.
                    </>
                  ) : (
                    <>
                      With <strong>{squadSize} players</strong> and <strong>{playersOnPitch} on the pitch</strong> for a <strong>{matchDurationMins}m</strong> match, each player should roughly play <strong>{formatTimeShort(targetPlayingSecondsPerMatch)}</strong>. During the game, you can monitor each player&apos;s live time and see who exceeds this target.
                    </>
                  )}
                </span>
              </div>

              {/* Squad Attendance Overview */}
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Attending Squad ({attendingPlayerIds.length}):
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                  gap: '6px'
                }}
              >
                {attendingPlayerIds.map((pId) => (
                  <div
                    key={pId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 8px',
                      background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.78rem',
                      color: 'var(--text-primary)',
                      overflow: 'hidden'
                    }}
                  >
                    <span
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        background: 'var(--bg-elevated)',
                        color: 'var(--pitch-green-light)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        flexShrink: 0
                      }}
                    >
                      {playerMap.get(pId)?.charAt(0).toUpperCase()}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {playerMap.get(pId) || 'Player'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid var(--danger-red)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 14px',
                color: '#fca5a5',
                fontSize: '0.85rem',
                marginBottom: '16px'
              }}
            >
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Confirm & Start Match Button */}
          <button
            type="submit"
            disabled={isSubmitting || attendingPlayerIds.length === 0}
            className="btn btn-primary btn-block btn-lg"
            style={{
              fontSize: '1.15rem',
              fontWeight: 800,
              boxShadow: '0 6px 20px var(--pitch-green-glow)',
              marginBottom: '30px'
            }}
          >
            <Play size={22} fill="#000" />
            Confirm Matchday ({matchesList.length === 1 ? 'Game 1' : `${matchesList.length} Games`})
          </button>
        </form>
      </main>
    </>
  );
}
