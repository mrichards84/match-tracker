'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, generateUUID } from '@/db';
import { Navbar } from '@/components/Navbar';
import { PWAInstallBanner } from '@/components/PWAInstallBanner';
import { Plus, Users, Trophy, ChevronRight, X, UserPlus, Shield } from 'lucide-react';
import { hapticFeedback } from '@/utils/haptics';

export default function HomePage() {
  const router = useRouter();
  const teams = useLiveQuery(() => db.teams.toArray(), []);
  const players = useLiveQuery(() => db.players.toArray(), []);
  const matches = useLiveQuery(() => db.matches.toArray(), []);

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [playerInput, setPlayerInput] = useState('');
  const [squadNames, setSquadNames] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleAddPlayer = () => {
    const trimmed = playerInput.trim();
    if (trimmed && !squadNames.includes(trimmed)) {
      setSquadNames([...squadNames, trimmed]);
      setPlayerInput('');
      hapticFeedback.tap();
    }
  };

  const handleRemovePlayer = (nameToRemove: string) => {
    setSquadNames(squadNames.filter((name) => name !== nameToRemove));
    hapticFeedback.tap();
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim() || isSaving) return;

    setIsSaving(true);
    hapticFeedback.tap();

    try {
      const teamId = generateUUID();
      const now = Date.now();

      await db.transaction('rw', [db.teams, db.players], async () => {
        await db.teams.add({
          id: teamId,
          name: newTeamName.trim(),
          createdAt: now,
          updatedAt: now
        });

        // Add any players currently in list or currently in the input box
        const finalSquad = [...squadNames];
        if (playerInput.trim() && !finalSquad.includes(playerInput.trim())) {
          finalSquad.push(playerInput.trim());
        }

        for (const pName of finalSquad) {
          await db.players.add({
            id: generateUUID(),
            teamId,
            name: pName.trim(),
            isActive: true,
            createdAt: now,
            updatedAt: now
          });
        }
      });

      setShowCreateModal(false);
      setNewTeamName('');
      setSquadNames([]);
      setPlayerInput('');
      router.push(`/teams/${teamId}`);
    } catch (err) {
      console.error('Failed to create team:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to get stats for a team card
  const getTeamMetrics = (teamId: string) => {
    const teamPlayers = (players || []).filter((p) => p.teamId === teamId && p.isActive);
    const teamMatches = (matches || []).filter((m) => m.teamId === teamId && m.status === 'completed');
    return {
      playerCount: teamPlayers.length,
      matchCount: teamMatches.length
    };
  };

  return (
    <>
      <Navbar title="Match Tracker" subtitle="Football Tracker & Stats" />

      <main className="main-content">
        <PWAInstallBanner />

        {/* Teams List Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              Teams
            </h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {(teams || []).length} {teams?.length === 1 ? 'squad' : 'squads'} registered
            </span>
          </div>

          {teams && teams.length > 0 && (
            <button
              onClick={() => {
                setShowCreateModal(true);
                hapticFeedback.tap();
              }}
              className="btn btn-primary"
              style={{ minHeight: '38px', padding: '6px 14px', fontSize: '0.88rem' }}
            >
              <Plus size={18} />
              New Team
            </button>
          )}
        </div>

        {/* Teams List */}
        {teams && teams.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {teams.map((team) => {
              const { playerCount, matchCount } = getTeamMetrics(team.id);
              return (
                <Link
                  key={team.id}
                  href={`/teams/${team.id}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div className="card" style={{ margin: 0, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div
                        style={{
                          width: '46px',
                          height: '46px',
                          borderRadius: 'var(--radius-lg)',
                          background: 'linear-gradient(135deg, #10b981 0%, #047857 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#000',
                          flexShrink: 0
                        }}
                      >
                        <Shield size={24} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-primary)' }}>
                          {team.name}
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Users size={14} /> {playerCount} players
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Trophy size={14} /> {matchCount} matches
                          </span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={20} color="var(--text-muted)" />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div
            className="card"
            style={{
              padding: '36px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px'
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: 'var(--bg-elevated)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--pitch-green)'
              }}
            >
              <Shield size={28} />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                No teams registered yet
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '320px', margin: '0 auto' }}>
                Create your football squad to begin tracking match minutes, substitutions, and goalscorers.
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary"
              style={{ marginTop: '8px' }}
            >
              <Plus size={18} />
              Create First Team
            </button>
          </div>
        )}
      </main>

      {/* Create Team Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Create Team</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowCreateModal(false)}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateTeam}>
              <div className="form-group">
                <label className="form-label" htmlFor="teamName">
                  Team Name *
                </label>
                <input
                  id="teamName"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Oakridge United"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Add Squad Players (Names only)
                </label>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Enter each player's name. You can also add more players later on the team page.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Player name (e.g. Leo, Sam)"
                    value={playerInput}
                    onChange={(e) => setPlayerInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddPlayer();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddPlayer}
                    className="btn btn-secondary"
                    style={{ flexShrink: 0 }}
                  >
                    <UserPlus size={18} />
                    Add
                  </button>
                </div>
              </div>

              {/* Squad preview chips */}
              {squadNames.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Squad Roster ({squadNames.length}):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {squadNames.map((name) => (
                      <span
                        key={name}
                        className="badge badge-green"
                        style={{
                          fontSize: '0.85rem',
                          padding: '6px 10px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        {name}
                        <button
                          type="button"
                          onClick={() => handleRemovePlayer(name)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'inherit',
                            cursor: 'pointer',
                            display: 'flex',
                            padding: 0
                          }}
                        >
                          <X size={14} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTeamName.trim() || isSaving}
                  className="btn btn-primary"
                  style={{ flex: 2 }}
                >
                  {isSaving ? 'Creating...' : 'Create Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
