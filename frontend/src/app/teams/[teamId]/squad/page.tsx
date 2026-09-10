'use client';

import React, { useState, use } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, generateUUID } from '@/db';
import { Navbar } from '@/components/Navbar';
import { calculateSeasonStats } from '@/utils/stats';
import { formatTimeShort, formatTimeLong, formatAverageTime } from '@/utils/formatters';
import {
  UserPlus,
  Edit2,
  UserX,
  UserCheck,
  ChevronDown,
  ChevronUp,
  X,
  Trophy,
  Clock,
  Shield,
  Search
} from 'lucide-react';
import { hapticFeedback } from '@/utils/haptics';

export default function SquadStatsPage({
  params
}: {
  params: Promise<{ teamId: string }>;
}) {
  const resolvedParams = use(params);
  const teamId = resolvedParams.teamId;

  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const players = useLiveQuery(
    () => db.players.where('teamId').equals(teamId).toArray(),
    [teamId]
  );
  const matches = useLiveQuery(
    () => db.matches.where('teamId').equals(teamId).toArray(),
    [teamId]
  );

  // States
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [editingPlayer, setEditingPlayer] = useState<{ id: string; name: string } | null>(null);
  const [showInactiveSection, setShowInactiveSection] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Calculate stats for all squad members
  const allStats = calculateSeasonStats(players || [], matches || []);

  const activeStats = allStats
    .filter((s) => s.isActive)
    .filter((s) => s.playerName.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => b.totalPlayingSeconds - a.totalPlayingSeconds);

  const inactiveStats = allStats
    .filter((s) => !s.isActive)
    .filter((s) => s.playerName.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => a.playerName.localeCompare(b.playerName));

  // Add new player
  const handleAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPlayerName.trim();
    if (!trimmed) return;

    hapticFeedback.tap();
    const now = Date.now();
    await db.players.add({
      id: generateUUID(),
      teamId,
      name: trimmed,
      isActive: true,
      createdAt: now,
      updatedAt: now
    });

    setNewPlayerName('');
    setShowAddModal(false);
  };

  // Edit player name
  const handleSavePlayerName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlayer || !editingPlayer.name.trim()) return;

    hapticFeedback.tap();
    await db.players.update(editingPlayer.id, {
      name: editingPlayer.name.trim(),
      updatedAt: Date.now()
    });

    setEditingPlayer(null);
  };

  // Toggle active/inactive
  const handleTogglePlayerStatus = async (playerId: string, makeActive: boolean) => {
    hapticFeedback.tap();
    await db.players.update(playerId, {
      isActive: makeActive,
      updatedAt: Date.now()
    });
  };

  return (
    <>
      <Navbar
        showBack
        backHref={`/teams/${teamId}`}
        title={team ? `${team.name} Squad` : 'Squad & Stats'}
        subtitle="Player Season Statistics"
        rightAction={
          <button
            onClick={() => setShowAddModal(true)}
            className="icon-button"
            style={{ width: '38px', height: '38px', background: 'var(--pitch-green)', color: '#000', borderColor: 'var(--pitch-green)' }}
            aria-label="Add Player"
          >
            <UserPlus size={18} />
          </button>
        }
      />

      <main className="main-content">
        {/* Search & Overview bar */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search
              size={18}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: '38px' }}
              placeholder="Search squad players..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary"
            style={{ flexShrink: 0, padding: '8px 14px', fontSize: '0.9rem' }}
          >
            <UserPlus size={18} />
            Add
          </button>
        </div>

        {/* Active Squad Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Active Players ({activeStats.length})
          </h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Ranked by total playing time
          </span>
        </div>

        {/* Active Players List */}
        {activeStats.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
            {activeStats.map((stat) => (
              <div
                key={stat.playerId}
                className="card"
                style={{
                  margin: 0,
                  padding: '16px',
                  background: 'var(--bg-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                {/* Player Top Line */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: 'var(--bg-elevated)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        color: 'var(--pitch-green-light)',
                        fontSize: '0.95rem'
                      }}
                    >
                      {stat.playerName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                        {stat.playerName}
                      </h3>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {stat.matchesPlayed} {stat.matchesPlayed === 1 ? 'match' : 'matches'} played
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      onClick={() => setEditingPlayer({ id: stat.playerId, name: stat.playerName })}
                      className="icon-button"
                      style={{ width: '34px', height: '34px' }}
                      title="Rename player"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => handleTogglePlayerStatus(stat.playerId, false)}
                      className="icon-button"
                      style={{ width: '34px', height: '34px', color: 'var(--text-muted)' }}
                      title="Mark inactive"
                    >
                      <UserX size={15} />
                    </button>
                  </div>
                </div>

                {/* Stats Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '8px',
                    background: 'var(--bg-surface)',
                    padding: '10px',
                    borderRadius: 'var(--radius-md)',
                    textAlign: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                      TOTAL TIME
                    </div>
                    <div className="tabular-nums" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--pitch-green-light)' }}>
                      {formatTimeLong(stat.totalPlayingSeconds)}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                      AVG / MATCH
                    </div>
                    <div className="tabular-nums" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {formatTimeShort(stat.averagePlayingSeconds)}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                      LAST MATCH
                    </div>
                    <div className="tabular-nums" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      {formatTimeShort(stat.lastMatchPlayingSeconds)}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                      GOALS
                    </div>
                    <div className="tabular-nums" style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--gk-gold)' }}>
                      ⚽ {stat.goalsScored}
                    </div>
                  </div>
                </div>

                {/* Goalkeeper minutes badge if player was GK */}
                {stat.goalkeeperSeconds > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--gk-gold-light)' }}>
                    <Shield size={14} />
                    <span>Goalkeeper time: <strong>{formatTimeShort(stat.goalkeeperSeconds)}</strong></span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
            No active players found matching "{searchQuery}".
          </div>
        )}

        {/* Collapsible Inactive / Former Players Section */}
        {inactiveStats.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            <button
              onClick={() => setShowInactiveSection(!showInactiveSection)}
              style={{
                width: '100%',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                color: 'var(--text-secondary)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 600 }}>
                <UserX size={16} />
                <span>Inactive / Former Players ({inactiveStats.length})</span>
              </div>
              {showInactiveSection ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {showInactiveSection && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                {inactiveStats.map((stat) => (
                  <div
                    key={stat.playerId}
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      opacity: 0.85
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {stat.playerName}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {stat.matchesPlayed} matches • {formatTimeLong(stat.totalPlayingSeconds)} • ⚽ {stat.goalsScored}
                      </div>
                    </div>
                    <button
                      onClick={() => handleTogglePlayerStatus(stat.playerId, true)}
                      className="btn btn-secondary"
                      style={{ minHeight: '34px', padding: '6px 12px', fontSize: '0.8rem' }}
                      title="Reactivate player"
                    >
                      <UserCheck size={14} />
                      Reactivate
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Add Player Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Add Player</h2>
              <button className="icon-button" onClick={() => setShowAddModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddPlayer}>
              <div className="form-group">
                <label className="form-label" htmlFor="newPlayerName">
                  Player Name *
                </label>
                <input
                  id="newPlayerName"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Charlie"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newPlayerName.trim()}
                  className="btn btn-primary"
                  style={{ flex: 2 }}
                >
                  Add Player
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Player Name Modal */}
      {editingPlayer && (
        <div className="modal-overlay" onClick={() => setEditingPlayer(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Player Name</h2>
              <button className="icon-button" onClick={() => setEditingPlayer(null)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSavePlayerName}>
              <div className="form-group">
                <label className="form-label" htmlFor="editPlayerName">
                  Correct Name
                </label>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Note: Updating the name corrects typos. Historical matches and goals remain attached to this player record.
                </p>
                <input
                  id="editPlayerName"
                  type="text"
                  className="form-input"
                  value={editingPlayer.name}
                  onChange={(e) => setEditingPlayer({ ...editingPlayer, name: e.target.value })}
                  required
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => setEditingPlayer(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!editingPlayer.name.trim()}
                  className="btn btn-primary"
                  style={{ flex: 2 }}
                >
                  Save Name
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
