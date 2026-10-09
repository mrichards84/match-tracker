// Database Schema and TypeScript Type Definitions

export interface Team {
  id: string; // UUID
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Player {
  id: string; // UUID
  teamId: string;
  name: string;
  isActive: boolean; // true = active squad, false = inactive/former player
  createdAt: number;
  updatedAt: number;
}

export type MatchFormat = '3v3' | '5v5' | '7v7' | '9v9' | '11v11' | 'custom';

export type MatchStatus = 'setup' | 'in_progress' | 'paused' | 'completed';

export type MatchEventType =
  | 'goal_for'
  | 'goal_against'
  | 'substitution'
  | 'gk_swap'
  | 'powerplay_in'
  | 'powerplay_out'
  | 'period_start'
  | 'period_end';

export interface MatchEvent {
  id: string;
  matchId: string;
  type: MatchEventType;
  timestampSeconds: number; // match clock seconds
  period: number; // 1 = 1st half, 2 = 2nd half, etc.
  playerId?: string; // player who scored, player coming on, or new GK
  subOutPlayerId?: string; // player subbed off, or former GK
  notes?: string;
  createdAt: number;
}

export interface PlayerMatchStint {
  playerId: string;
  role: 'outfield' | 'goalkeeper';
  startSecond: number;
  endSecond?: number; // populated when stint ends
}

export interface PlannedSubChange {
  inPlayerId: string;
  outPlayerId: string;
}

export interface PlannedSubstitution {
  id: string;
  period: number;
  timestampSeconds: number; // match clock seconds when substitution is scheduled
  label: string; // e.g. "10:00"
  gkChange?: {
    inPlayerId: string;
    outPlayerId?: string;
  };
  outfieldChanges: PlannedSubChange[];
  applied?: boolean;
  dismissed?: boolean;
  targetGoalkeeperId?: string;
  targetOutfieldPlayerIds?: string[];
  targetBenchPlayerIds?: string[];
}

export interface Match {
  id: string;
  teamId: string;
  opposition: string;
  date: string; // ISO date string (YYYY-MM-DD)
  format: MatchFormat;
  targetPeriods: number; // default 2 (halves)
  periodDurationMinutes: number; // e.g. 20, 25, 30
  currentPeriod: number;
  status: MatchStatus;

  // Running timer state with drift protection
  elapsedSeconds: number;
  lastStartedAt?: number; // Date.now() timestamp when timer was last started
  scoreFor: number;
  scoreAgainst: number;

  // Multi-match session linkage
  matchGroupId?: string;
  matchGroupIndex?: number; // 1-based (e.g. 1 for Match 1)
  matchGroupTotal?: number; // total matches in this matchday session
  nextMatchId?: string;
  previousMatchId?: string;

  // Matchday squad attendance & GK rotation plan
  matchdaySquadPlayerIds?: string[];
  plannedGkPlayerIds?: string[];
  plannedSubstitutions?: PlannedSubstitution[];

  // Starting lineup configuration
  startingGoalkeeperId?: string;
  startingOutfieldPlayerIds: string[];
  benchPlayerIds: string[];

  // Current live lineup tracking
  activeGoalkeeperId?: string;
  activeOutfieldPlayerIds: string[];
  activePowerplayPlayerIds: string[];

  // Historical records for this match
  stints: PlayerMatchStint[];
  events: MatchEvent[];

  createdAt: number;
  completedAt?: number;
  playerOfTheMatchId?: string; // Optional ID of player chosen as Player of the Match
}

export interface PlayerSeasonStats {
  playerId: string;
  playerName: string;
  isActive: boolean;
  matchesPlayed: number;
  totalPlayingSeconds: number;
  averagePlayingSeconds: number;
  lastMatchPlayingSeconds: number;
  goalkeeperSeconds: number;
  goalsScored: number;
  playerOfTheMatchCount: number;
}

export interface DatabaseBackup {
  version: number;
  exportedAt: string;
  teams: Team[];
  players: Player[];
  matches: Match[];
}
