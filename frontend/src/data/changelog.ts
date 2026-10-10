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

export const CURRENT_APP_VERSION = '0.4.3';

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '0.4.3',
    title: 'Pure Pitch Substitutions & Streamlined Setup',
    date: 'October 2026',
    isLatest: true,
    highlights: [
      {
        icon: 'refresh',
        title: 'Pure Pitch Substitutions',
        description: 'Removed complex goalkeeper rotation scheduling from setup so the algorithm solves pure equal pitch playing time without role-conflict confusion.'
      },
      {
        icon: 'shield',
        title: 'Optional Starting Goalkeeper',
        description: 'Optionally designate a starting goalkeeper for each match during setup, while retaining the freedom to change goalkeepers on the fly in-game.'
      },
      {
        icon: 'sparkles',
        title: 'Streamlined Matchday Setup',
        description: 'Simplified match setup workflow into 4 clean steps with crystal-clear target playing time and bench time metrics.'
      }
    ]
  },
  {
    version: '0.4.2',
    title: 'Equal Playing Time Accuracy & Substitution Strategies',
    date: 'October 2026',
    isLatest: false,
    highlights: [
      {
        icon: 'refresh',
        title: 'GK-Aware Equal Playing Time',
        description: 'Fixed goalkeeper playing time bias by enforcing bench shifts during outfield windows, eliminating the 5-minute disparity.'
      },
      {
        icon: 'clock',
        title: 'Predictable Lengths Strategy',
        description: 'New recommended substitution strategy that splits rotations evenly so minimal players (1–2) swap per stoppage for continuous team rhythm.'
      },
      {
        icon: 'zap',
        title: 'Minimum Interruptions Strategy',
        description: 'Bunched substitutions grouped at key match stoppages (goalkeeper changes and period breaks) to minimize play pauses.'
      },
      {
        icon: 'sparkles',
        title: 'Fixed Interval Cadence',
        description: 'Flexible recurring cadence (every 5m, 6m, 7.5m, 8m, 10m, or halves only) for traditional rotation schedules.'
      }
    ]
  },
  {
    version: '0.4.1',
    title: 'Silent Alerts, Draft Auto-Save & Goalkeeper Glove Icon',
    date: 'October 2026',
    isLatest: false,
    highlights: [
      {
        icon: 'zap',
        title: 'Silent by Default (Vibration Only)',
        description: 'Referee whistles and audio chimes are now muted by default so you can rely purely on discreet phone vibration alerts.'
      },
      {
        icon: 'refresh',
        title: 'Matchday Draft Auto-Save & Pre-Match Review',
        description: 'Never lose entered opponents or attendance: drafts auto-save continuously, with full pre-match lineup review and kick-off controls.'
      },
      {
        icon: 'sparkles',
        title: 'Pitchside Audio Toggle & Settings',
        description: 'Instant Mute / Sound On toggle pill directly on the match timer HUD, plus haptic vibration test controls in Settings.'
      },
      {
        icon: 'shield',
        title: 'Custom Goalkeeper Glove Icon',
        description: 'Sleek custom goalie glove catching soccer ball icon for quick goalkeeper swaps on the pitch.'
      }
    ]
  },
  {
    version: '0.4.0',
    title: 'Multi-Match Setup & Equal Playing Time Planner',
    date: 'October 2026',
    isLatest: false,
    highlights: [
      {
        icon: 'sparkles',
        title: 'Multi-Match Matchday Setup',
        description: 'Set up 1 or more matches in advance with custom opposition names, independent match durations, and game formats.'
      },
      {
        icon: 'shield',
        title: 'Goalkeeper Rotation Sharing',
        description: 'Select multiple players to share goalkeeper duties. Goalie minutes are split equally across your matches.'
      },
      {
        icon: 'clock',
        title: 'Guaranteed Equal Playing Time',
        description: 'Automatic substitution scheduling balances outfield and goalkeeper minutes so every squad member gets equal match time.'
      },
      {
        icon: 'zap',
        title: 'Live Substitution Reminders & 1-Tap Swaps',
        description: 'Get audio, haptic, and visual notifications when it is time to rotate, with 1-tap execution of planned changes.'
      },
      {
        icon: 'refresh',
        title: 'Seamless Game-to-Game Flow',
        description: 'Finish Game 1 and transition directly into Game 2 with lineups and rotation plans ready to go.'
      }
    ]
  },
  {
    version: '0.3.0',
    title: 'Quick Player Actions & Dynamic Formats',
    date: 'September 2026',
    isLatest: false,
    highlights: [
      {
        icon: 'sparkles',
        title: 'Quick Player Action Icons',
        description: 'Record goals (⚽), swap goalkeepers (🛡️), and make substitutions (🔄) directly from player cards with single-tap ease.'
      },
      {
        icon: 'zap',
        title: 'Dynamic Match Size & Extra Players',
        description: 'Easily adjust the number of players on the pitch mid-game — switch from 5-a-side to 6-a-side, bring on an extra player by mutual agreement, or use powerplay.'
      },
      {
        icon: 'refresh',
        title: 'Streamlined Substitutions',
        description: 'Pick replacements directly from the pitch card or bench card, plus an option to take players off without replacement if numbers drop.'
      }
    ]
  },
  {
    version: '0.2.0',
    title: 'Match Timing, POTM & Updates',
    date: 'September 2026',
    isLatest: false,
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
