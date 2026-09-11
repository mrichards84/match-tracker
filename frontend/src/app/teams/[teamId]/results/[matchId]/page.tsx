'use client';

import React, { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { Navbar } from '@/components/Navbar';
import { calculatePlayerMatchSeconds } from '@/utils/stats';
import { formatMatchDate, formatTimeShort, formatMMSS } from '@/utils/formatters';
import {
  Calendar,
  Clock,
  Share2,
  Check,
  Trophy,
  Shield,
  ArrowRightLeft,
  Trash2,
  AlertTriangle,
  X,
  Users,
  Star,
  Edit2
} from 'lucide-react';
import { hapticFeedback } from '@/utils/haptics';

export default function MatchResultDetailsPage({
  params
}: {
  params: Promise<{ teamId: string; matchId: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const teamId = resolvedParams.teamId;
  const matchId = resolvedParams.matchId;

  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const match = useLiveQuery(() => db.matches.get(matchId), [matchId]);
  const players = useLiveQuery(
    () => db.players.where('teamId').equals(teamId).toArray(),
    [teamId]
  );

  const [copied, setCopied] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPotmModal, setShowPotmModal] = useState(false);

  const playerMap = new Map((players || []).map((p) => [p.id, p]));

  if (!match || !team) {
    return (
      <>
        <Navbar showBack backHref={`/teams/${teamId}/results`} title="Result Details" />
        <main className="main-content" style={{ textAlign: 'center', paddingTop: '40px' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading match report...</p>
        </main>
      </>
    );
  }

  // Calculate outcome
  const outcome =
    match.scoreFor > match.scoreAgainst
      ? { label: 'VICTORY', badgeClass: 'badge-green', color: 'var(--pitch-green-light)' }
      : match.scoreFor < match.scoreAgainst
      ? { label: 'DEFEAT', badgeClass: 'badge-red', color: '#fca5a5' }
      : { label: 'DRAW', badgeClass: 'badge-gold', color: 'var(--gk-gold-light)' };

  // Generate per-player stats for this match
  const playerStats = (players || []).map((player) => {
    const stats = calculatePlayerMatchSeconds(match, player.id);
    return {
      player,
      ...stats
    };
  }).filter((p) => p.totalSeconds > 0 || p.goals > 0);

  // Generate WhatsApp / Share text
  const generateMatchReportText = () => {
    const lines: string[] = [];
    lines.push(`⚽ MATCH RESULT: ${team.name} ${match.scoreFor} - ${match.scoreAgainst} ${match.opposition}`);
    lines.push(`🗓️ ${formatMatchDate(match.date)} | ${match.format} (${formatTimeShort(match.elapsedSeconds)})`);
    lines.push('');

    // Player of the Match
    if (match.playerOfTheMatchId) {
      const potmName = playerMap.get(match.playerOfTheMatchId)?.name;
      if (potmName) {
        lines.push(`⭐ Player of the Match: ${potmName}`);
        lines.push('');
      }
    }

    // Goals
    const teamGoals = match.events.filter((e) => e.type === 'goal_for');
    if (teamGoals.length > 0) {
      lines.push('⚽ Goals:');
      teamGoals.forEach((g) => {
        const scorer = playerMap.get(g.playerId || '')?.name || 'Unassigned';
        const mins = Math.floor(g.timestampSeconds / 60);
        lines.push(`• ${mins}' ${scorer}`);
      });
      lines.push('');
    }

    // Goalkeepers
    const gkStints = (match.stints || []).filter((s) => s.role === 'goalkeeper');
    if (gkStints.length > 0) {
      lines.push('🧤 Goalkeeper Time:');
      const gkTimes = new Map<string, number>();
      gkStints.forEach((s) => {
        const dur = (s.endSecond ?? match.elapsedSeconds) - s.startSecond;
        gkTimes.set(s.playerId, (gkTimes.get(s.playerId) || 0) + dur);
      });
      gkTimes.forEach((dur, pId) => {
        const name = playerMap.get(pId)?.name || 'Unknown';
        lines.push(`• ${name}: ${formatTimeShort(dur)}`);
      });
      lines.push('');
    }

    // Squad pitch minutes
    lines.push('⏱️ Playing Time:');
    playerStats.forEach((p) => {
      const goalText = p.goals > 0 ? ` (⚽ ${p.goals})` : '';
      lines.push(`• ${p.player.name}: ${formatTimeShort(p.totalSeconds)}${goalText}`);
    });

    return lines.join('\n');
  };

  const handleShare = async () => {
    hapticFeedback.tap();
    const text = generateMatchReportText();

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `${team.name} vs ${match.opposition} - Match Summary`,
          text
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore
    }
  };

  const handleUpdatePotm = async (newPotmId: string | null) => {
    hapticFeedback.tap();
    await db.matches.update(matchId, {
      playerOfTheMatchId: newPotmId || undefined
    });
    setShowPotmModal(false);
  };

  const handleDeleteMatch = async () => {
    hapticFeedback.warning();
    await db.matches.delete(matchId);
    router.push(`/teams/${teamId}/results`);
  };

  return (
    <>
      <Navbar
        showBack
        backHref={`/teams/${teamId}/results`}
        title="Match Report"
        subtitle={`vs ${match.opposition}`}
        rightAction={
          <button
            onClick={handleShare}
            className="btn btn-primary"
            style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.8rem' }}
          >
            {copied ? <Check size={16} /> : <Share2 size={16} />}
            {copied ? 'Copied' : 'Share'}
          </button>
        }
      />

      <main className="main-content">
        {/* Result Header Hero Card */}
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, #111a28 0%, #18263a 100%)',
            border: '1.5px solid var(--border-subtle)',
            padding: '20px 16px',
            textAlign: 'center',
            marginBottom: '16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
            <span className={`badge ${outcome.badgeClass}`} style={{ fontSize: '0.8rem', padding: '3px 10px' }}>
              {outcome.label}
            </span>
            <span className="badge badge-muted" style={{ fontSize: '0.8rem' }}>
              {match.format}
            </span>
          </div>

          {/* Big Final Score */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              gap: '12px',
              margin: '12px 0'
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {team.name}
              </div>
              <div className="tabular-nums" style={{ fontSize: '3rem', fontWeight: 900, color: outcome.color }}>
                {match.scoreFor}
              </div>
            </div>

            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-muted)' }}>
              -
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {match.opposition}
              </div>
              <div className="tabular-nums" style={{ fontSize: '3rem', fontWeight: 900, color: 'var(--text-secondary)' }}>
                {match.scoreAgainst}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Calendar size={14} /> {formatMatchDate(match.date)}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={14} /> {formatTimeShort(match.elapsedSeconds)} duration
            </span>
          </div>

          {/* Player of the Match Highlight */}
          <div
            style={{
              marginTop: '16px',
              padding: '12px 14px',
              background: match.playerOfTheMatchId
                ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.08) 100%)'
                : 'rgba(255, 255, 255, 0.04)',
              border: match.playerOfTheMatchId
                ? '1px solid rgba(245, 158, 11, 0.4)'
                : '1px dashed var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: match.playerOfTheMatchId ? 'var(--gk-gold)' : 'var(--bg-elevated)',
                  color: match.playerOfTheMatchId ? '#000' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <Star size={18} fill={match.playerOfTheMatchId ? '#000' : 'none'} />
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: match.playerOfTheMatchId ? 'var(--gk-gold)' : 'var(--text-muted)' }}>
                  Player of the Match
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {match.playerOfTheMatchId ? (playerMap.get(match.playerOfTheMatchId)?.name || 'Unknown') : 'Not selected'}
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                hapticFeedback.tap();
                setShowPotmModal(true);
              }}
              className="btn btn-ghost"
              style={{
                fontSize: '0.78rem',
                padding: '6px 10px',
                minHeight: '30px',
                borderColor: match.playerOfTheMatchId ? 'rgba(245, 158, 11, 0.4)' : 'var(--border-subtle)',
                color: match.playerOfTheMatchId ? 'var(--gk-gold-light)' : 'var(--text-secondary)'
              }}
            >
              {match.playerOfTheMatchId ? 'Change' : 'Award POTM'}
            </button>
          </div>

          {/* Share Button Inside Card */}
          <button
            onClick={handleShare}
            className="btn btn-secondary btn-block"
            style={{ marginTop: '16px', fontSize: '0.9rem' }}
          >
            {copied ? <Check size={18} color="var(--pitch-green-light)" /> : <Share2 size={18} />}
            {copied ? 'Summary Copied to Clipboard!' : 'Copy / Share Summary for WhatsApp'}
          </button>
        </div>

        {/* Chronological Match Timeline */}
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Clock size={18} color="var(--pitch-green-light)" />
            Match Timeline ({match.events.length} events)
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', position: 'relative' }}>
            {match.events.map((ev, index) => {
              const mins = Math.floor(ev.timestampSeconds / 60);
              const playerOn = playerMap.get(ev.playerId || '');
              const playerOff = playerMap.get(ev.subOutPlayerId || '');

              return (
                <div
                  key={ev.id || index}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '8px 10px',
                    background: 'var(--bg-surface)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div
                    className="tabular-nums"
                    style={{
                      width: '42px',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      color: 'var(--pitch-green-light)',
                      flexShrink: 0
                    }}
                  >
                    {formatMMSS(ev.timestampSeconds)}
                  </div>

                  <div style={{ flex: 1 }}>
                    {ev.type === 'goal_for' && (
                      <div>
                        <span style={{ fontWeight: 800, color: 'var(--pitch-green-light)' }}>⚽ GOAL!</span>{' '}
                        <span style={{ fontWeight: 700, color: '#fff' }}>{playerOn?.name || team.name}</span>
                      </div>
                    )}
                    {ev.type === 'goal_against' && (
                      <div>
                        <span style={{ fontWeight: 800, color: 'var(--danger-red)' }}>Goal Against:</span>{' '}
                        <span style={{ color: 'var(--text-secondary)' }}>{match.opposition} scored</span>
                      </div>
                    )}
                    {ev.type === 'substitution' && (
                      <div style={{ fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--sub-blue)' }}>🔄 Sub:</span>{' '}
                        <strong style={{ color: 'var(--pitch-green-light)' }}>{playerOn?.name} ON</strong>{' '}
                        <span style={{ color: 'var(--text-muted)' }}>/</span>{' '}
                        <strong style={{ color: 'var(--danger-red)' }}>{playerOff?.name} OFF</strong>
                      </div>
                    )}
                    {ev.type === 'gk_swap' && (
                      <div style={{ fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--gk-gold)' }}>🧤 GK Rotation:</span>{' '}
                        <strong style={{ color: 'var(--gk-gold-light)' }}>{playerOn?.name}</strong> in goal
                        {playerOff && <span style={{ color: 'var(--text-muted)' }}> (replaced {playerOff.name})</span>}
                      </div>
                    )}
                    {ev.type === 'powerplay_in' && (
                      <div style={{ fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--powerplay-purple)' }}>⚡ Powerplay ON:</span>{' '}
                        <strong>{playerOn?.name}</strong> brought on
                      </div>
                    )}
                    {ev.type === 'powerplay_out' && (
                      <div style={{ fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--powerplay-purple)' }}>⚡ Powerplay OFF:</span>{' '}
                        <strong>{playerOn?.name}</strong> reverted to bench
                      </div>
                    )}
                    {ev.type === 'period_start' && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        🏁 {ev.notes || `Period ${ev.period} started`}
                      </div>
                    )}
                    {ev.type === 'period_end' && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        🏁 {ev.notes || `Period ${ev.period} ended`}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Player Performance Breakdown Table */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Users size={18} color="var(--sub-blue)" />
            Player Match Minutes & Goals
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {playerStats.map((stat) => (
              <div
                key={stat.player.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {stat.player.name}
                    {match.playerOfTheMatchId === stat.player.id && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          padding: '1px 6px',
                          borderRadius: '10px',
                          background: 'rgba(245, 158, 11, 0.2)',
                          color: 'var(--gk-gold)',
                          border: '1px solid rgba(245, 158, 11, 0.4)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                      >
                        <Star size={10} fill="var(--gk-gold)" /> POTM
                      </span>
                    )}
                  </div>
                  {stat.goalkeeperSeconds > 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--gk-gold-light)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Shield size={12} /> GK: {formatTimeShort(stat.goalkeeperSeconds)}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {stat.goals > 0 && (
                    <span className="badge badge-gold tabular-nums">
                      ⚽ {stat.goals}
                    </span>
                  )}
                  <span className="badge badge-green tabular-nums">
                    {formatTimeShort(stat.totalSeconds)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Delete Match Option */}
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="btn btn-ghost"
            style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}
          >
            <Trash2 size={15} /> Delete this match record
          </button>
        </div>
      </main>

      {/* Delete Match Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: 'var(--danger-red)' }}>
                Delete Match Record?
              </h2>
              <button className="icon-button" onClick={() => setShowDeleteModal(false)}>
                <X size={20} />
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '18px' }}>
              Are you sure you want to permanently delete this match record? This will remove its minutes and goals from player statistics.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setShowDeleteModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteMatch}
                className="btn btn-danger"
                style={{ flex: 2 }}
              >
                Delete Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Player of the Match Edit Modal */}
      {showPotmModal && (
        <div className="modal-overlay" onClick={() => setShowPotmModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Star size={20} color="var(--gk-gold)" fill="var(--gk-gold)" />
                Player of the Match
              </h2>
              <button className="icon-button" onClick={() => setShowPotmModal(false)}>
                <X size={20} />
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '14px' }}>
              Select the player to award Player of the Match for this game vs <strong>{match.opposition}</strong>.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto', marginBottom: '16px' }}>
              {playerStats.map(({ player }) => {
                const isSelected = match.playerOfTheMatchId === player.id;
                return (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => handleUpdatePotm(player.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: isSelected ? '1.5px solid var(--gk-gold)' : '1px solid var(--border-subtle)',
                      background: isSelected ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-surface)',
                      color: isSelected ? '#fff' : 'var(--text-primary)',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: isSelected ? 'var(--gk-gold)' : 'var(--bg-elevated)',
                          color: isSelected ? '#000' : 'var(--text-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.8rem',
                          fontWeight: 800
                        }}
                      >
                        {isSelected ? <Star size={15} fill="#000" /> : player.name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontWeight: isSelected ? 700 : 500, fontSize: '0.9rem' }}>
                        {player.name}
                      </span>
                    </div>
                    {isSelected && (
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gk-gold)' }}>
                        Selected ⭐
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              {match.playerOfTheMatchId && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1, color: 'var(--danger-red)' }}
                  onClick={() => handleUpdatePotm(null)}
                >
                  Remove Award
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setShowPotmModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
