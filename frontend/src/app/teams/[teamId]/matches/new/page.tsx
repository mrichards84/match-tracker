'use client';

import React, { useState, use, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, generateUUID } from '@/db';
import type { MatchFormat, PlayerMatchStint, Match } from '@/db/schema';
import { Navbar } from '@/components/Navbar';
import { GoalkeeperIcon } from '@/components/GoalkeeperIcon';
import {
  calculateRotationPlan,
  type MatchSetupConfig,
  type RotationFrequencySetting
} from '@/utils/rotationPlanner';
import { formatMMSS, formatTimeShort } from '@/utils/formatters';
import {
  Shield,
  Users,
  Play,
  Clock,
  CheckCircle,
  AlertCircle,
  Plus,
  Trash2,
  ArrowUpDown,
  Calendar,
  ChevronDown,
  ChevronUp,
  Info,
  Layers,
  ArrowRight,
  Sparkles,
  Check,
  Zap,
  Sliders
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

  // --- Step 4: Substitution Strategy & Frequency ---
  const [rotationStrategy, setRotationStrategy] = useState<'predictable_lengths' | 'minimum_interruptions' | 'fixed'>('predictable_lengths');
  const [fixedInterval, setFixedInterval] = useState<string>('5');

  const effectiveRotationFreq: RotationFrequencySetting =
    rotationStrategy === 'predictable_lengths'
      ? 'predictable_lengths'
      : rotationStrategy === 'minimum_interruptions'
      ? 'minimum_interruptions'
      : (fixedInterval as RotationFrequencySetting);

  // Preview tab & submission state
  const [activePreviewTab, setActivePreviewTab] = useState<'breakdown' | 'timeline'>('breakdown');
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
        if (parsed.rotationFreq) {
          if (parsed.rotationFreq === 'predictable_lengths') {
            setRotationStrategy('predictable_lengths');
          } else if (parsed.rotationFreq === 'minimum_interruptions') {
            setRotationStrategy('minimum_interruptions');
          } else if (parsed.rotationFreq === 'auto') {
            setRotationStrategy('predictable_lengths');
          } else {
            setRotationStrategy('fixed');
            setFixedInterval(parsed.rotationFreq);
          }
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
        rotationFreq: effectiveRotationFreq,
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
    customPlayersOnPitch,
    effectiveRotationFreq
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
    setRotationStrategy('predictable_lengths');
    setFixedInterval('5');
    setErrorMsg('');
  };

  // Active Preset
  const activePreset = FORMAT_PRESETS.find((p) => p.id === format) || FORMAT_PRESETS[2];
  const playersOnPitch = format === 'custom' ? customPlayersOnPitch : activePreset.totalOnPitch;

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

  // Run Rotation Planner calculation in real-time
  const rotationPlan = useMemo(() => {
    if (attendingPlayerIds.length === 0 || matchesList.length === 0) return null;

    const plannerMatches: MatchSetupConfig[] = matchesList.map((m, idx) => ({
      matchIndex: idx + 1,
      opposition: m.opposition.trim() || `Game ${idx + 1}`,
      format,
      targetPeriods: m.targetPeriods,
      periodDurationMinutes: m.periodDurationMinutes,
      startingGoalkeeperId: m.startingGoalkeeperId
    }));

    return calculateRotationPlan({
      squadPlayerIds: attendingPlayerIds,
      playersOnPitch,
      matches: plannerMatches,
      rotationFrequency: effectiveRotationFreq
    });
  }, [attendingPlayerIds, playersOnPitch, matchesList, format, effectiveRotationFreq]);

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

    if (!rotationPlan || rotationPlan.matches.length === 0) {
      setErrorMsg('Could not calculate rotation plan. Please check match settings.');
      return;
    }

    setIsSubmitting(true);
    hapticFeedback.tap();

    try {
      const matchGroupId = generateUUID();
      const now = Date.now();
      const todayIso = new Date().toISOString().split('T')[0];

      // Pre-generate UUIDs for all matches in the group so we can link them
      const matchIds = rotationPlan.matches.map(() => generateUUID());

      // Prepare database match records
      const dbMatches: Match[] = rotationPlan.matches.map((planMatch, idx) => {
        const matchId = matchIds[idx];
        const isFirstMatch = idx === 0;
        const nextMatchId = idx < matchIds.length - 1 ? matchIds[idx + 1] : undefined;
        const previousMatchId = idx > 0 ? matchIds[idx - 1] : undefined;

        // Build initial stints for the match
        const initialStints: PlayerMatchStint[] = [];
        if (isFirstMatch) {
          if (planMatch.startingGoalkeeperId) {
            initialStints.push({
              playerId: planMatch.startingGoalkeeperId,
              role: 'goalkeeper',
              startSecond: 0
            });
          }
          planMatch.startingOutfieldPlayerIds.forEach((pId) => {
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
          opposition: matchesList[idx].opposition.trim(),
          date: todayIso,
          format: planMatch.format,
          targetPeriods: planMatch.targetPeriods,
          periodDurationMinutes: planMatch.periodDurationMinutes,
          currentPeriod: 1,
          status: 'setup',
          elapsedSeconds: 0,
          lastStartedAt: undefined,
          scoreFor: 0,
          scoreAgainst: 0,

          // Multi-match linkage
          matchGroupId,
          matchGroupIndex: idx + 1,
          matchGroupTotal: rotationPlan.matches.length,
          nextMatchId,
          previousMatchId,

          // Squad & rotation plan
          matchdaySquadPlayerIds: attendingPlayerIds,
          plannedGkPlayerIds: planMatch.startingGoalkeeperId ? [planMatch.startingGoalkeeperId] : [],
          plannedSubstitutions: planMatch.plannedSubstitutions,

          // Starting lineup
          startingGoalkeeperId: planMatch.startingGoalkeeperId,
          startingOutfieldPlayerIds: planMatch.startingOutfieldPlayerIds,
          benchPlayerIds: planMatch.benchPlayerIds,

          // Live lineup
          activeGoalkeeperId: isFirstMatch ? planMatch.startingGoalkeeperId : undefined,
          activeOutfieldPlayerIds: isFirstMatch ? planMatch.startingOutfieldPlayerIds : [],
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

      // Navigate straight to Match 1 live tracking page for pre-match review
      router.push(`/teams/${teamId}/matches/${matchIds[0]}`);
    } catch (err) {
      console.error('Failed to create matchday:', err);
      setErrorMsg('Error creating match session. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalMatchdayMins = matchesList.reduce(
    (sum, m) => sum + m.targetPeriods * m.periodDurationMinutes,
    0
  );

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
                    Smart Matchday Planner
                  </h1>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                    Set up 1 or more games with guaranteed equal playing time & goalkeeper rotation.
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

          {/* Section 3: Game Format & Frequency */}
          <div className="card">
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Layers size={18} color="var(--powerplay-purple)" />
              <span>3. Pitch Format & Rotation Pacing</span>
            </div>

            {/* Match Format Selector */}
            <div className="form-group" style={{ marginBottom: '12px' }}>
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
              <div className="form-group" style={{ marginBottom: '12px' }}>
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

            {/* Substitution Strategy Options */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: '0.82rem', marginBottom: '8px' }}>
                Substitution Strategy
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginBottom: '8px' }}>
                {/* Option 1: Predictable Lengths */}
                <button
                  type="button"
                  onClick={() => {
                    setRotationStrategy('predictable_lengths');
                    hapticFeedback.tap();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${rotationStrategy === 'predictable_lengths' ? 'var(--pitch-green)' : 'var(--border-subtle)'}`,
                    background: rotationStrategy === 'predictable_lengths' ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-surface)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: 'var(--radius-sm)',
                      background: rotationStrategy === 'predictable_lengths' ? 'var(--pitch-green)' : 'var(--bg-elevated)',
                      color: rotationStrategy === 'predictable_lengths' ? '#000' : 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <Clock size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#fff' }}>
                        Predictable Lengths
                      </span>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          background: 'rgba(16, 185, 129, 0.2)',
                          color: 'var(--pitch-green-light)',
                          padding: '2px 6px',
                          borderRadius: 'var(--radius-full)'
                        }}
                      >
                        Recommended
                      </span>
                    </div>
                    <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                      Split substitutions up so they occur regularly and the minimum number of players is changed at each stoppage (1–2 players) for pitch stability.
                    </p>
                  </div>
                </button>

                {/* Option 2: Minimum Interruptions */}
                <button
                  type="button"
                  onClick={() => {
                    setRotationStrategy('minimum_interruptions');
                    hapticFeedback.tap();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${rotationStrategy === 'minimum_interruptions' ? 'var(--sub-blue)' : 'var(--border-subtle)'}`,
                    background: rotationStrategy === 'minimum_interruptions' ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: 'var(--radius-sm)',
                      background: rotationStrategy === 'minimum_interruptions' ? 'var(--sub-blue)' : 'var(--bg-elevated)',
                      color: rotationStrategy === 'minimum_interruptions' ? '#fff' : 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <Zap size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#fff' }}>
                      Minimum Interruptions
                    </span>
                    <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                      Reduce the number of times play is stopped by bunching substitutions together, aligned with goalkeeper changes and period breaks.
                    </p>
                  </div>
                </button>

                {/* Option 3: Fixed Interval */}
                <button
                  type="button"
                  onClick={() => {
                    setRotationStrategy('fixed');
                    hapticFeedback.tap();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${rotationStrategy === 'fixed' ? 'var(--powerplay-purple)' : 'var(--border-subtle)'}`,
                    background: rotationStrategy === 'fixed' ? 'rgba(168, 85, 247, 0.08)' : 'var(--bg-surface)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: 'var(--radius-sm)',
                      background: rotationStrategy === 'fixed' ? 'var(--powerplay-purple)' : 'var(--bg-elevated)',
                      color: rotationStrategy === 'fixed' ? '#fff' : 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <Sliders size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#fff' }}>
                      Fixed Interval Cadence
                    </span>
                    <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                      Rotate at an exact recurring clock interval (e.g. every 5, 6, 7.5, or 10 minutes) regardless of other events.
                    </p>
                  </div>
                </button>
              </div>

              {/* Fixed Interval Selector (only shown if Fixed Interval is selected) */}
              {rotationStrategy === 'fixed' && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '12px',
                    background: 'var(--bg-surface)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '6px' }}>
                    Choose Fixed Interval:
                  </label>
                  <select
                    className="form-input"
                    value={fixedInterval}
                    onChange={(e) => setFixedInterval(e.target.value)}
                    style={{ minHeight: '40px', fontSize: '0.85rem' }}
                  >
                    <option value="5">Every 5 minutes</option>
                    <option value="6">Every 6 minutes</option>
                    <option value="7.5">Every 7.5 minutes</option>
                    <option value="8">Every 8 minutes</option>
                    <option value="10">Every 10 minutes</option>
                    <option value="12">Every 12 minutes</option>
                    <option value="15">Every 15 minutes</option>
                    <option value="half_only">At Halves / Periods only</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Section 5: Equal Playing Time Preview & Verification */}
          {rotationPlan && (
            <div className="card" style={{ border: '1.5px solid var(--border-strong)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={18} color="var(--pitch-green)" />
                  <span>4. Equal Playing Time Guarantee</span>
                </div>
                <span
                  style={{
                    background:
                      rotationPlan.maxDisparitySeconds === 0
                        ? 'rgba(16, 185, 129, 0.15)'
                        : rotationPlan.isFullyBalanced
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'rgba(59, 130, 246, 0.15)',
                    color:
                      rotationPlan.maxDisparitySeconds === 0
                        ? 'var(--pitch-green-light)'
                        : rotationPlan.isFullyBalanced
                        ? 'var(--pitch-green-light)'
                        : 'var(--sub-blue)',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-full)'
                  }}
                >
                  {rotationPlan.maxDisparitySeconds === 0
                    ? '✓ 100% Equal Time'
                    : rotationPlan.isFullyBalanced
                    ? '✓ Guaranteed Equal (<2m variance)'
                    : `Bunched Rotations (±${formatTimeShort(rotationPlan.maxDisparitySeconds)})`}
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
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Target Playing Time</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--pitch-green-light)' }}>
                    {formatTimeShort(rotationPlan.targetPlayingSecondsPerPlayer)}
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
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Bench Time Each</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                    {formatTimeShort(rotationPlan.totalMatchdaySeconds - rotationPlan.targetPlayingSecondsPerPlayer)}
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
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Max Variance</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff' }}>
                    ±{formatTimeShort(rotationPlan.maxDisparitySeconds)}
                  </div>
                </div>
              </div>

              {/* Strategy Details Banner */}
              <div
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-surface)',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                <Info size={15} color="var(--sub-blue)" style={{ flexShrink: 0 }} />
                <span>
                  {rotationStrategy === 'predictable_lengths'
                    ? 'Predictable shifts: Rotations occur regularly with 1–2 players swapped per stoppage for pitch stability and equal playing time.'
                    : rotationStrategy === 'minimum_interruptions'
                    ? 'Minimum interruptions: Substitutions are bunched at key stoppages (e.g. half-time / period breaks) to minimize match pauses.'
                    : `Fixed cadence: Substitutions scheduled every ${fixedInterval} minutes.`}
                </span>
              </div>

              {/* Tabs for Breakdown vs Timeline */}
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  background: 'var(--bg-surface)',
                  padding: '4px',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '12px'
                }}
              >
                <button
                  type="button"
                  onClick={() => setActivePreviewTab('breakdown')}
                  className={`btn ${activePreviewTab === 'breakdown' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, minHeight: '34px', fontSize: '0.8rem', padding: '4px' }}
                >
                  Squad Minutes Breakdown
                </button>
                <button
                  type="button"
                  onClick={() => setActivePreviewTab('timeline')}
                  className={`btn ${activePreviewTab === 'timeline' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, minHeight: '34px', fontSize: '0.8rem', padding: '4px' }}
                >
                  Rotation Timeline Schedule
                </button>
              </div>

              {/* Tab 1: Squad Minutes Breakdown Table */}
              {activePreviewTab === 'breakdown' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {rotationPlan.playerSummaries.map((summary) => {
                    const playerName = playerMap.get(summary.playerId) || 'Player';

                    return (
                      <div
                        key={summary.playerId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          background: 'var(--bg-surface)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.82rem'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                          <span
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '50%',
                              background: 'var(--bg-elevated)',
                              color: 'var(--pitch-green-light)',
                              fontWeight: 700,
                              fontSize: '0.72rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}
                          >
                            {playerName.charAt(0).toUpperCase()}
                          </span>
                          <span
                            style={{
                              fontWeight: 600,
                              color: '#fff',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {playerName}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            🪑 {formatTimeShort(summary.benchSeconds)} rest
                          </span>
                          <span
                            style={{
                              fontWeight: 800,
                              color: 'var(--pitch-green-light)',
                              minWidth: '55px',
                              textAlign: 'right'
                            }}
                          >
                            🏃 {formatTimeShort(summary.totalPlayingSeconds)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tab 2: Timeline Schedule */}
              {activePreviewTab === 'timeline' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {rotationPlan.matches.map((planMatch, mIdx) => (
                    <div
                      key={mIdx}
                      style={{
                        background: 'var(--bg-surface)',
                        borderRadius: 'var(--radius-md)',
                        padding: '10px 12px'
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          color: 'var(--sub-blue)',
                          marginBottom: '8px'
                        }}
                      >
                        Match {mIdx + 1}: vs {matchesList[mIdx]?.opposition || `Game ${mIdx + 1}`}
                      </div>

                      {/* Starting Lineup for this match */}
                      <div
                        style={{
                          fontSize: '0.78rem',
                          padding: '6px 8px',
                          background: 'var(--bg-card)',
                          borderRadius: 'var(--radius-sm)',
                          marginBottom: '8px'
                        }}
                      >
                        <div style={{ fontWeight: 700, color: '#fff', marginBottom: '3px' }}>
                          00:00 Kick-off Starting Lineup:
                        </div>
                        <div style={{ color: 'var(--gk-gold)' }}>
                          🧤 GK: <strong>{playerMap.get(planMatch.startingGoalkeeperId || '')}</strong>
                        </div>
                        <div style={{ color: 'var(--pitch-green-light)', marginTop: '2px' }}>
                          🏃 Pitch: {planMatch.startingOutfieldPlayerIds.map((id) => playerMap.get(id)).join(', ')}
                        </div>
                        {planMatch.benchPlayerIds.length > 0 && (
                          <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>
                            🪑 Bench: {planMatch.benchPlayerIds.map((id) => playerMap.get(id)).join(', ')}
                          </div>
                        )}
                      </div>

                      {/* Scheduled Substitutions */}
                      {planMatch.plannedSubstitutions.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {planMatch.plannedSubstitutions.map((sub, sIdx) => (
                            <div
                              key={sub.id}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                fontSize: '0.76rem',
                                padding: '6px 8px',
                                background: 'var(--bg-elevated)',
                                borderRadius: 'var(--radius-sm)'
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 800,
                                  color: 'var(--pitch-green)',
                                  flexShrink: 0,
                                  marginTop: '1px'
                                }}
                              >
                                {sub.label}
                              </span>
                              <div style={{ flex: 1 }}>
                                {sub.gkChange && (
                                  <div style={{ color: 'var(--gk-gold)', fontWeight: 600 }}>
                                    🧤 GK Swap: {playerMap.get(sub.gkChange.inPlayerId)} in for {playerMap.get(sub.gkChange.outPlayerId || '')}
                                  </div>
                                )}
                                {sub.outfieldChanges.map((chg, cIdx) => (
                                  <div key={cIdx} style={{ color: 'var(--text-primary)' }}>
                                    🔄 {playerMap.get(chg.inPlayerId)} ON ↔️ {playerMap.get(chg.outPlayerId)} OFF
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          No mid-game substitutions (squad matches pitch count).
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
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

          {/* Big Start Matchday Button */}
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
            Confirm & Review Matchday ({matchesList.length === 1 ? 'Game 1' : `${matchesList.length} Games`})
          </button>
        </form>
      </main>
    </>
  );
}
