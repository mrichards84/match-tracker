export interface ChangelogHighlight {
  icon: 'clock' | 'refresh' | 'shield' | 'sparkles' | 'zap' | 'star';
  title: string;
  description: string;
}

export interface ChangelogRelease {
  version: string;
  title: string;
  date: string;
  isLatest?: boolean;
  highlights: ChangelogHighlight[];
}

export const CURRENT_APP_VERSION = '0.2.0';

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '0.2.0',
    title: 'Match Timing, POTM & Updates',
    date: 'September 2026',
    isLatest: true,
    highlights: [
      {
        icon: 'star',
        title: 'Player of the Match',
        description: 'Award Player of the Match when ending a game, featured prominently on the match report and tracked across your squad statistics.'
      },
      {
        icon: 'clock',
        title: 'Shorter Half Lengths (5, 6, 10, 15 mins)',
        description: 'You can now configure fast 5, 6, 10, and 15-minute halves/periods — perfect for youth soccer, tournaments, and mini-matches.'
      },
      {
        icon: 'refresh',
        title: 'Seamless PWA Updates',
        description: 'Installed app instances now detect, apply, and alert you to new features automatically with zero manual reinstall needed.'
      },
      {
        icon: 'shield',
        title: 'Offline-First & Safe Local Data',
        description: 'All team squads, player minutes, substitutions, and historical results remain 100% intact and preserved in local storage.'
      }
    ]
  },
  {
    version: '0.1.0',
    title: 'Initial Release',
    date: 'September 2026',
    highlights: [
      {
        icon: 'sparkles',
        title: 'Pitch-side Match Tracking',
        description: 'Live match stopwatch, player minutes, goalkeeper rotation tracking, goal events, and full offline IndexedDB storage.'
      }
    ]
  }
];
