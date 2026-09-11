'use client';

import React, { useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, generateUUID } from '@/db';
import { Navbar } from '@/components/Navbar';
import {
  Play,
  Users,
  Trophy,
  Edit2,
  Check,
  X,
  UserPlus,
  ArrowRight,
  Shield,
  Activity,
  AlertCircle
} from 'lucide-react';
import { hapticFeedback } from '@/utils/haptics';

export default function TeamHubPage({
  params
}: {
  params: Promise<{ teamId: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const teamId = resolvedParams.teamId;

  // Live queries from Dexie
  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const players = useLiveQuery(
    () => db.players.where('teamId').equals(teamId).toArray(),
    [teamId]
  );
  const matches = useLiveQuery(
    () => db.matches.where('teamId').equals(teamId).toArray(),
    [teamId]
  );

  // Edit Team Name State
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  // Quick Add Player State
  const [quickPlayerName, setQuickPlayerName] = useState('');
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);

  // Check for in-progress match
  const liveMatch = (matches || []).find(
    (m) => m.status === 'in_progress' || m.status === 'paused'
  );
  const completedMatches = (matches || []).filter((m) => m.status === 'completed');
  const activePlayers = (players || []).filter((p) => p.isActive);

  const handleSaveTeamName = async () => {
    if (!editedName.trim() || !team) return;
    await db.teams.update(teamId, {
      name: editedName.trim(),
      updatedAt: Date.now()
    });
    setIsEditingName(false);
    hapticFeedback.tap();
  };

  const handleQuickAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = quickPlayerName.trim();
    if (!trimmed) return;

    setIsAddingPlayer(true);
    hapticFeedback.tap();
    try {
      const now = Date.now();
      await db.players.add({
        id: generateUUID(),
        teamId,
        name: trimmed,
        isActive: true,
        createdAt: now,
        updatedAt: now
      });
      setQuickPlayerName('');
    } finally {
      setIsAddingPlayer(false);
    }
  };

  if (!team) {
    return (
      <>
        <Navbar showBack backHref="/" title="Team Not Found" />
        <main className="main-content" style={{ textAlign: 'center', paddingTop: '40px' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading or team does not exist.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar
        showBack
        backHref="/"
        title={team.name}
        subtitle="Team Dashboard"
      />

      <main className="main-content">
        {/* Live Match Alert Banner */}
        {liveMatch && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.3) 100%)',
              border: '1.5px solid var(--pitch-green)',
              borderRadius: 'var(--radius-lg)',
              padding: '16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              boxShadow: 'var(--shadow-glow)',
              animation: 'pulseGlow 2.5s infinite ease-in-out'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: 'var(--pitch-green)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#000',
                  flexShrink: 0
                }}
              >
                <Activity size={22} />
              </div>
              <div>
                <div style={{ fontWeight: 800, color: '#fff', fontSize: '1rem' }}>
                  Match In Progress!
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--pitch-green-light)' }}>
                  vs {liveMatch.opposition || 'Opponent'} ({liveMatch.scoreFor} - {liveMatch.scoreAgainst})
                </div>
              </div>
            </div>
            <Link
              href={`/teams/${teamId}/matches/${liveMatch.id}`}
              className="btn btn-primary"
              style={{ minHeight: '40px', padding: '6px 14px', fontSize: '0.9rem' }}
            >
              Resume
            </Link>
          </div>
        )}

        {/* Team Header Card */}
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, #131c2a 0%, #1a283c 100%)',
            padding: '20px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ flex: 1 }}>
              {isEditingName ? (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
                  <input
                    type="text"
                    className="form-input"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    style={{ minHeight: '40px', padding: '6px 10px', fontSize: '1.1rem', fontWeight: 700 }}
                    autoFocus
                  />
                  <button
                    onClick={handleSaveTeamName}
                    className="btn btn-primary"
                    style={{ minHeight: '40px', padding: '8px 12px' }}
                    aria-label="Save name"
                  >
                    <Check size={18} />
                  </button>
                  <button
                    onClick={() => setIsEditingName(false)}
                    className="btn btn-ghost"
                    style={{ minHeight: '40px', padding: '8px 12px' }}
                    aria-label="Cancel editing"
                  >
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                    {team.name}
                  </h2>
                  <button
                    onClick={() => {
                      setEditedName(team.name);
                      setIsEditingName(true);
                      hapticFeedback.tap();
                    }}
                    className="icon-button"
                    style={{ width: '32px', height: '32px', border: 'none' }}
                    aria-label="Edit team name"
                  >
                    <Edit2 size={16} />
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', gap: '14px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <span>{activePlayers.length} active players</span>
                <span>•</span>
                <span>{completedMatches.length} matches played</span>
              </div>
            </div>

            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-elevated)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--pitch-green)'
              }}
            >
              <Shield size={26} />
            </div>
          </div>
        </div>

        {/* Primary Action Buttons Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', marginBottom: '20px' }}>
          {/* Start Match Button */}
          <Link
            href={`/teams/${teamId}/matches/new`}
            style={{ textDecoration: 'none' }}
          >
            <div
              className="card"
              style={{
                margin: 0,
                background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                borderColor: '#10b981',
                padding: '20px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: '#fff',
                boxShadow: '0 6px 18px var(--pitch-green-glow)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '50%',
                    background: 'rgba(255, 255, 255, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Play size={24} fill="#fff" />
                </div>
                <div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>Start Match</div>
                  <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                    Lineup, timer, subs & live tracking
                  </div>
                </div>
              </div>
              <ArrowRight size={22} />
            </div>
          </Link>

          {/* View Squad & Stats */}
          <Link
            href={`/teams/${teamId}/squad`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div
              className="card"
              style={{
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(14, 165, 233, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--sub-blue)'
                  }}
                >
                  <Users size={22} />
                </div>
                <div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Squad & Statistics
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Season minutes, GK rotation & goals
                  </div>
                </div>
              </div>
              <ArrowRight size={20} color="var(--text-muted)" />
            </div>
          </Link>

          {/* View Results History */}
          <Link
            href={`/teams/${teamId}/results`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div
              className="card"
              style={{
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(245, 158, 11, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--gk-gold)'
                  }}
                >
                  <Trophy size={22} />
                </div>
                <div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Match Results
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {completedMatches.length} historical match reports & timelines
                  </div>
                </div>
              </div>
              <ArrowRight size={20} color="var(--text-muted)" />
            </div>
          </Link>
        </div>

        {/* Quick Squad */}
        <div style={{ marginTop: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Active Squad ({activePlayers.length})
            </h3>
            <Link
              href={`/teams/${teamId}/squad`}
              style={{ fontSize: '0.8rem', color: 'var(--pitch-green-light)', textDecoration: 'none' }}
            >
              Manage Squad →
            </Link>
          </div>

          {/* Quick Add Player Input */}
          <form onSubmit={handleQuickAddPlayer} style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Add player name..."
              value={quickPlayerName}
              onChange={(e) => setQuickPlayerName(e.target.value)}
            />
            <button
              type="submit"
              disabled={!quickPlayerName.trim() || isAddingPlayer}
              className="btn btn-secondary"
              style={{ flexShrink: 0 }}
            >
              <UserPlus size={18} />
              Add
            </button>
          </form>

          {/* Active players pills */}
          {activePlayers.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {activePlayers.map((player) => (
                <div
                  key={player.id}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px 12px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)'
                  }}
                >
                  {player.name}
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                background: 'var(--bg-surface)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-secondary)',
                fontSize: '0.85rem'
              }}
            >
              <AlertCircle size={20} style={{ margin: '0 auto 6px auto', display: 'block', color: 'var(--gk-gold)' }} />
              No active players in squad. Add players to start a match.
            </div>
          )}
        </div>
      </main>
    </>
  );
}
