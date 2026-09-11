'use client';

import React, { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, generateUUID } from '@/db';
import type { MatchFormat, PlayerMatchStint } from '@/db/schema';
import { Navbar } from '@/components/Navbar';
import {
  Shield,
  Users,
  Play,
  Clock,
  CheckCircle,
  AlertCircle,
  Plus
} from 'lucide-react';
import { hapticFeedback } from '@/utils/haptics';

interface FormatPreset {
  id: MatchFormat;
  label: string;
  defaultOutfield: number;
  hasGK: boolean;
}

const FORMAT_PRESETS: FormatPreset[] = [
  { id: '3v3', label: '3v3', defaultOutfield: 2, hasGK: true },
  { id: '5v5', label: '5v5', defaultOutfield: 4, hasGK: true },
  { id: '7v7', label: '7v7', defaultOutfield: 6, hasGK: true },
  { id: '9v9', label: '9v9', defaultOutfield: 8, hasGK: true },
  { id: '11v11', label: '11v11', defaultOutfield: 10, hasGK: true },
  { id: 'custom', label: 'Custom', defaultOutfield: 4, hasGK: true }
];

export default function MatchSetupPage({
  params
}: {
  params: Promise<{ teamId: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const teamId = resolvedParams.teamId;

  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const players = useLiveQuery(
    () => db.players.where('teamId').equals(teamId).and((p) => p.isActive).toArray(),
    [teamId]
  );

  // Form State
  const [opposition, setOpposition] = useState('');
  const [format, setFormat] = useState<MatchFormat>('7v7');
  const [targetPeriods, setTargetPeriods] = useState<number>(2); // 2 halves
  const [periodDurationMinutes, setPeriodDurationMinutes] = useState<number>(25);

  // Lineup state
  const [goalkeeperId, setGoalkeeperId] = useState<string>('');
  const [outfieldIds, setOutfieldIds] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Find preset details
  const activePreset = FORMAT_PRESETS.find((p) => p.id === format) || FORMAT_PRESETS[2];
  const requiredOutfield = activePreset.defaultOutfield;
  const availablePlayers = players || [];

  // Bench is active players not in GK or outfield
  const benchIds = availablePlayers
    .map((p) => p.id)
    .filter((id) => id !== goalkeeperId && !outfieldIds.includes(id));

  // Toggle Goalkeeper
  const handleSelectGK = (playerId: string) => {
    hapticFeedback.tap();
    setErrorMsg('');
    if (goalkeeperId === playerId) {
      setGoalkeeperId('');
    } else {
      setGoalkeeperId(playerId);
      // Remove from outfield if was outfield
      setOutfieldIds(outfieldIds.filter((id) => id !== playerId));
    }
  };

  // Toggle Outfield Starter
  const handleToggleOutfield = (playerId: string) => {
    hapticFeedback.tap();
    setErrorMsg('');
    if (outfieldIds.includes(playerId)) {
      setOutfieldIds(outfieldIds.filter((id) => id !== playerId));
    } else {
      // Remove from GK if was GK
      if (goalkeeperId === playerId) {
        setGoalkeeperId('');
      }
      setOutfieldIds([...outfieldIds, playerId]);
    }
  };

  const handleStartMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!opposition.trim()) {
      setErrorMsg('Please enter opposition team name.');
      return;
    }

    if (activePreset.hasGK && !goalkeeperId) {
      setErrorMsg('Please assign a starting Goalkeeper (GK).');
      return;
    }

    if (outfieldIds.length === 0) {
      setErrorMsg('Please select at least one starting outfield player.');
      return;
    }

    setIsSubmitting(true);
    hapticFeedback.tap();

    try {
      const matchId = generateUUID();
      const now = Date.now();
      const todayIso = new Date().toISOString().split('T')[0];

      // Build initial stints starting at 0
      const initialStints: PlayerMatchStint[] = [];

      if (goalkeeperId) {
        initialStints.push({
          playerId: goalkeeperId,
          role: 'goalkeeper',
          startSecond: 0
        });
      }

      for (const pId of outfieldIds) {
        initialStints.push({
          playerId: pId,
          role: 'outfield',
          startSecond: 0
        });
      }

      await db.matches.add({
        id: matchId,
        teamId,
        opposition: opposition.trim(),
        date: todayIso,
        format,
        targetPeriods,
        periodDurationMinutes,
        currentPeriod: 1,
        status: 'in_progress',
        elapsedSeconds: 0,
        lastStartedAt: now, // starts running immediately
        scoreFor: 0,
        scoreAgainst: 0,
        startingGoalkeeperId: goalkeeperId,
        startingOutfieldPlayerIds: outfieldIds,
        benchPlayerIds: benchIds,
        activeGoalkeeperId: goalkeeperId,
        activeOutfieldPlayerIds: outfieldIds,
        activePowerplayPlayerIds: [],
        stints: initialStints,
        events: [
          {
            id: generateUUID(),
            matchId,
            type: 'period_start',
            timestampSeconds: 0,
            period: 1,
            notes: 'Match kick-off',
            createdAt: now
          }
        ],
        createdAt: now
      });

      router.push(`/teams/${teamId}/matches/${matchId}`);
    } catch (err) {
      console.error('Failed to create match:', err);
      setErrorMsg('Error creating match. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Navbar
        showBack
        backHref={`/teams/${teamId}`}
        title="Match Setup"
        subtitle={team?.name}
      />

      <main className="main-content">
        <form onSubmit={handleStartMatch}>
          {/* Opposition Input Card */}
          <div className="card">
            <div className="card-title">Match Info</div>
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label className="form-label" htmlFor="opposition">
                Opposition Team Name *
              </label>
              <input
                id="opposition"
                type="text"
                className="form-input"
                placeholder="e.g. Redbridge Rovers"
                value={opposition}
                onChange={(e) => {
                  setOpposition(e.target.value);
                  setErrorMsg('');
                }}
                required
                autoFocus
              />
            </div>

            {/* Match Format Selector */}
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label className="form-label">Match Format</label>
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
                    style={{ minHeight: '44px', padding: '6px 8px', fontSize: '0.9rem' }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Match Timing & Halves */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Periods</label>
                <select
                  className="form-input"
                  value={targetPeriods}
                  onChange={(e) => setTargetPeriods(Number(e.target.value))}
                >
                  <option value={1}>1 Single Period</option>
                  <option value={2}>2 Halves</option>
                  <option value={4}>4 Quarters</option>
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Half Length</label>
                <select
                  className="form-input"
                  value={periodDurationMinutes}
                  onChange={(e) => setPeriodDurationMinutes(Number(e.target.value))}
                >
                  <option value={5}>5 mins</option>
                  <option value={6}>6 mins</option>
                  <option value={10}>10 mins</option>
                  <option value={15}>15 mins</option>
                  <option value={20}>20 mins</option>
                  <option value={25}>25 mins</option>
                  <option value={30}>30 mins</option>
                  <option value={35}>35 mins</option>
                  <option value={40}>40 mins</option>
                  <option value={45}>45 mins</option>
                </select>
              </div>
            </div>
          </div>

          {/* Starting Lineup Builder */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div className="card-title" style={{ margin: 0 }}>
                Starting Lineup ({outfieldIds.length + (goalkeeperId ? 1 : 0)} on pitch)
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Target: {requiredOutfield} outfield + 1 GK
              </div>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
              Tap <strong>GK</strong> to set goalkeeper. Tap player cards to toggle <strong>Outfield Starter</strong>. Remaining players will be on the bench.
            </p>

            {/* Players Selection List */}
            {availablePlayers.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {availablePlayers.map((player) => {
                  const isGK = goalkeeperId === player.id;
                  const isOutfield = outfieldIds.includes(player.id);
                  const isBench = !isGK && !isOutfield;

                  return (
                    <div
                      key={player.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-md)',
                        background: isGK
                          ? 'rgba(245, 158, 11, 0.15)'
                          : isOutfield
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'var(--bg-surface)',
                        border: isGK
                          ? '1.5px solid var(--gk-gold)'
                          : isOutfield
                          ? '1.5px solid var(--pitch-green)'
                          : '1px solid var(--border-subtle)',
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: isGK
                              ? 'var(--gk-gold)'
                              : isOutfield
                              ? 'var(--pitch-green)'
                              : 'var(--bg-elevated)',
                            color: isGK || isOutfield ? '#000' : 'var(--text-secondary)',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.85rem'
                          }}
                        >
                          {isGK ? 'GK' : player.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {player.name}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: isGK ? 'var(--gk-gold-light)' : isOutfield ? 'var(--pitch-green-light)' : 'var(--text-muted)' }}>
                            {isGK ? 'Starting Goalkeeper' : isOutfield ? 'Outfield Starter' : 'Sub / Bench'}
                          </div>
                        </div>
                      </div>

                      {/* Selection Toggles */}
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {activePreset.hasGK && (
                          <button
                            type="button"
                            onClick={() => handleSelectGK(player.id)}
                            className={`btn ${isGK ? 'btn-gold' : 'btn-ghost'}`}
                            style={{
                              minHeight: '34px',
                              padding: '4px 10px',
                              fontSize: '0.78rem',
                              borderRadius: 'var(--radius-sm)'
                            }}
                          >
                            GK
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleOutfield(player.id)}
                          className={`btn ${isOutfield ? 'btn-primary' : 'btn-secondary'}`}
                          style={{
                            minHeight: '34px',
                            padding: '4px 12px',
                            fontSize: '0.78rem',
                            borderRadius: 'var(--radius-sm)'
                          }}
                        >
                          {isOutfield ? 'Pitch Starter' : 'Add Starter'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
                No active players in squad. Add players to the squad first.
              </div>
            )}
          </div>

          {/* Error notice if any */}
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

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || availablePlayers.length === 0}
            className="btn btn-primary btn-block btn-lg"
            style={{
              fontSize: '1.15rem',
              boxShadow: '0 6px 20px var(--pitch-green-glow)',
              marginBottom: '30px'
            }}
          >
            <Play size={22} fill="#000" />
            Start Match & Timer
          </button>
        </form>
      </main>
    </>
  );
}
