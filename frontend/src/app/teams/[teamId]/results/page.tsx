'use client';

import React, { use } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { Navbar } from '@/components/Navbar';
import { formatMatchDate, formatTimeShort } from '@/utils/formatters';
import { Trophy, ChevronRight, Calendar, Clock, Plus, Shield } from 'lucide-react';

export default function ResultsListPage({
  params
}: {
  params: Promise<{ teamId: string }>;
}) {
  const resolvedParams = use(params);
  const teamId = resolvedParams.teamId;

  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const matches = useLiveQuery(
    () => db.matches.where('teamId').equals(teamId).toArray(),
    [teamId]
  );

  const completedMatches = (matches || [])
    .filter((m) => m.status === 'completed')
    .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt));

  // Determine outcome badge
  const getOutcome = (scoreFor: number, scoreAgainst: number) => {
    if (scoreFor > scoreAgainst) return { label: 'WIN', badgeClass: 'badge-green' };
    if (scoreFor < scoreAgainst) return { label: 'LOSS', badgeClass: 'badge-red' };
    return { label: 'DRAW', badgeClass: 'badge-gold' };
  };

  return (
    <>
      <Navbar
        showBack
        backHref={`/teams/${teamId}`}
        title={team ? `${team.name} Results` : 'Match Results'}
        subtitle="Completed Matches"
      />

      <main className="main-content">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Match History ({completedMatches.length})
          </h2>
          <Link
            href={`/teams/${teamId}/matches/new`}
            className="btn btn-primary"
            style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.85rem' }}
          >
            <Plus size={16} /> New Match
          </Link>
        </div>

        {completedMatches.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {completedMatches.map((match) => {
              const outcome = getOutcome(match.scoreFor, match.scoreAgainst);

              return (
                <Link
                  key={match.id}
                  href={`/teams/${teamId}/results/${match.id}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div
                    className="card"
                    style={{
                      margin: 0,
                      padding: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {/* Score Badge */}
                      <div
                        style={{
                          width: '54px',
                          height: '54px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}
                      >
                        <div className="tabular-nums" style={{ fontSize: '1.2rem', fontWeight: 900, color: '#fff' }}>
                          {match.scoreFor}-{match.scoreAgainst}
                        </div>
                        <span className={`badge ${outcome.badgeClass}`} style={{ fontSize: '0.65rem', padding: '1px 5px' }}>
                          {outcome.label}
                        </span>
                      </div>

                      {/* Match Details */}
                      <div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                          vs {match.opposition}
                        </h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Calendar size={13} /> {formatMatchDate(match.date)}
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={13} /> {formatTimeShort(match.elapsedSeconds)}
                          </span>
                          <span className="badge badge-muted" style={{ fontSize: '0.68rem' }}>
                            {match.format}
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
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                background: 'var(--bg-elevated)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--gk-gold)'
              }}
            >
              <Trophy size={26} />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                No match results recorded yet
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '300px', margin: '0 auto' }}>
                Start a match and track goals, substitutions, and minutes. Completed matches will appear here.
              </p>
            </div>
            <Link
              href={`/teams/${teamId}/matches/new`}
              className="btn btn-primary"
              style={{ marginTop: '8px' }}
            >
              <Plus size={18} />
              Setup Match
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
