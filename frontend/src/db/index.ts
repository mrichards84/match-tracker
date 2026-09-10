import Dexie, { type Table } from 'dexie';
import type { Team, Player, Match, DatabaseBackup } from './schema';

export class MatchTrackerDB extends Dexie {
  teams!: Table<Team, string>;
  players!: Table<Player, string>;
  matches!: Table<Match, string>;

  constructor() {
    super('MatchTrackerDB');
    this.version(1).stores({
      teams: 'id, name, createdAt',
      players: 'id, teamId, name, isActive, [teamId+isActive]',
      matches: 'id, teamId, status, date, createdAt, [teamId+status]'
    });
  }
}

export const db = new MatchTrackerDB();

// Safe UUID Generator
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Full Database Export to JSON
export async function exportDatabase(): Promise<string> {
  const teams = await db.teams.toArray();
  const players = await db.players.toArray();
  const matches = await db.matches.toArray();

  const backup: DatabaseBackup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    teams,
    players,
    matches
  };

  return JSON.stringify(backup, null, 2);
}

// Full Database Restore from JSON
export async function importDatabase(jsonData: string): Promise<{ success: boolean; message: string }> {
  try {
    const backup: DatabaseBackup = JSON.parse(jsonData);
    if (!backup || !backup.teams || !backup.players || !backup.matches) {
      return { success: false, message: 'Invalid backup format: missing core tables.' };
    }

    await db.transaction('rw', [db.teams, db.players, db.matches], async () => {
      await db.teams.clear();
      await db.players.clear();
      await db.matches.clear();

      await db.teams.bulkAdd(backup.teams);
      await db.players.bulkAdd(backup.players);
      await db.matches.bulkAdd(backup.matches);
    });

    return { success: true, message: 'Database successfully restored.' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to restore database: ${msg}` };
  }
}
