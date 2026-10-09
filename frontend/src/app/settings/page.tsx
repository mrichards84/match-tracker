'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Navbar } from '@/components/Navbar';
import { exportDatabase, importDatabase, db } from '@/db';
import {
  Download,
  Upload,
  Database,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Smartphone,
  Info,
  Shield,
  Sparkles,
  Volume2,
  VolumeX,
  Bell
} from 'lucide-react';
import { sound, isSoundEnabled, setSoundEnabled } from '@/utils/audio';
import { hapticFeedback, isHapticsEnabled, setHapticsEnabled } from '@/utils/haptics';
import { CURRENT_APP_VERSION } from '@/data/changelog';

export default function SettingsPage() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [soundActive, setSoundActive] = useState(false);
  const [hapticsActive, setHapticsActive] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSoundActive(isSoundEnabled());
    setHapticsActive(isHapticsEnabled());
  }, []);

  const handleToggleSound = () => {
    const next = !soundActive;
    setSoundActive(next);
    setSoundEnabled(next);
    hapticFeedback.tap();
    if (next) {
      sound.previewWhistle();
    }
  };

  const handleToggleHaptics = () => {
    const next = !hapticsActive;
    setHapticsActive(next);
    setHapticsEnabled(next);
    if (next) {
      hapticFeedback.subAlert();
    }
  };

  const handleExportBackup = async () => {
    try {
      setExporting(true);
      hapticFeedback.tap();
      const jsonString = await exportDatabase();

      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      link.href = url;
      link.download = `match-tracker-backup-${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setMessage({ text: 'Backup exported successfully!', type: 'success' });
    } catch (err) {
      setMessage({ text: 'Failed to export backup.', type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setImporting(true);
      hapticFeedback.tap();
      const text = await file.text();
      const result = await importDatabase(text);

      if (result.success) {
        setMessage({ text: 'Database restored successfully! Reloading...', type: 'success' });
        setTimeout(() => {
          window.location.href = '/';
        }, 1500);
      } else {
        setMessage({ text: result.message, type: 'error' });
      }
    } catch (err) {
      setMessage({ text: 'Invalid JSON backup file.', type: 'error' });
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleClearAllData = async () => {
    hapticFeedback.warning();
    await db.transaction('rw', [db.teams, db.players, db.matches], async () => {
      await db.teams.clear();
      await db.players.clear();
      await db.matches.clear();
    });
    setShowClearConfirm(false);
    setMessage({ text: 'All data cleared.', type: 'success' });
    setTimeout(() => {
      window.location.href = '/';
    }, 1000);
  };

  return (
    <>
      <Navbar showBack backHref="/" title="Settings" subtitle="Data & Offline Storage" />

      <main className="main-content">
        {/* Status Message */}
        {message && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '0.9rem',
              background: message.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              border: `1px solid ${message.type === 'success' ? 'var(--pitch-green)' : 'var(--danger-red)'}`,
              color: message.type === 'success' ? 'var(--pitch-green-light)' : '#fca5a5'
            }}
          >
            {message.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            <span>{message.text}</span>
          </div>
        )}

        {/* Match Alerts & Feedback Card */}
        <div className="card">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bell size={18} color="var(--pitch-green)" />
            Match Alerts & Feedback
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.4 }}>
            Control pitch-side audio sound effects and phone vibrations during matches.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Sound Effects Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: soundActive ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-elevated)',
                    color: soundActive ? 'var(--pitch-green)' : 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  {soundActive ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </div>
                <div>
                  <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff' }}>
                    Whistle & Sound Effects
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {soundActive
                      ? 'Enabled — Plays referee whistles and alert chimes'
                      : 'Disabled — Silent (No whistles or audio chimes)'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {soundActive && (
                  <button
                    type="button"
                    onClick={() => sound.previewWhistle()}
                    className="btn btn-ghost"
                    style={{ minHeight: '34px', padding: '4px 8px', fontSize: '0.75rem', color: 'var(--pitch-green-light)' }}
                    title="Preview whistle sound"
                  >
                    Test
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleToggleSound}
                  className={`btn ${soundActive ? 'btn-primary' : 'btn-secondary'}`}
                  style={{
                    minHeight: '34px',
                    padding: '4px 14px',
                    fontSize: '0.82rem',
                    fontWeight: 700
                  }}
                >
                  {soundActive ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>

            {/* Vibration Alerts Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: hapticsActive ? 'rgba(14, 165, 233, 0.2)' : 'var(--bg-elevated)',
                    color: hapticsActive ? 'var(--sub-blue)' : 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <Smartphone size={18} />
                </div>
                <div>
                  <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff' }}>
                    Phone Vibration (Haptics)
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {hapticsActive
                      ? 'Enabled — Vibrates for sub reminders, period breaks & goals'
                      : 'Disabled — No vibration feedback'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {hapticsActive && (
                  <button
                    type="button"
                    onClick={() => hapticFeedback.subAlert()}
                    className="btn btn-ghost"
                    style={{ minHeight: '34px', padding: '4px 8px', fontSize: '0.75rem', color: 'var(--sub-blue)' }}
                    title="Test vibration pulse"
                  >
                    Test
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleToggleHaptics}
                  className={`btn ${hapticsActive ? 'btn-primary' : 'btn-secondary'}`}
                  style={{
                    minHeight: '34px',
                    padding: '4px 14px',
                    fontSize: '0.82rem',
                    fontWeight: 700
                  }}
                >
                  {hapticsActive ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* App Updates & Changelog Card */}
        <div className="card">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={18} color="var(--pitch-green)" />
              App Updates & Changelog
            </div>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '12px',
                background: 'rgba(16, 185, 129, 0.15)',
                color: 'var(--pitch-green-light)',
                border: '1px solid rgba(16, 185, 129, 0.3)'
              }}
            >
              v{CURRENT_APP_VERSION}
            </span>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.4 }}>
            Match Tracker automatically updates in the background. Tap below to see what was added in the latest release.
          </p>
          <button
            onClick={() => {
              hapticFeedback.tap();
              window.dispatchEvent(new CustomEvent('open-changelog'));
            }}
            className="btn btn-secondary btn-block"
            style={{ justifyContent: 'center', padding: '12px 16px' }}
          >
            <Sparkles size={16} color="var(--pitch-green-light)" style={{ marginRight: '6px' }} />
            View What's New & Release Notes
          </button>
        </div>

        {/* Data Portability Card */}
        <div className="card">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={18} color="var(--pitch-green)" />
            Local Data & Backup
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.4 }}>
            All your team squads, matches, and player minutes are stored directly on this device using IndexedDB (zero cloud delay, works 100% offline).
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Export */}
            <button
              onClick={handleExportBackup}
              disabled={exporting}
              className="btn btn-secondary btn-block"
              style={{ justifyContent: 'flex-start', padding: '14px 16px' }}
            >
              <Download size={18} color="var(--pitch-green-light)" />
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>Export JSON Backup</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Download a copy of all teams, squads, and match history
                </div>
              </div>
            </button>

            {/* Import */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".json,application/json"
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="btn btn-secondary btn-block"
              style={{ justifyContent: 'flex-start', padding: '14px 16px' }}
            >
              <Upload size={18} color="var(--sub-blue)" />
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>Restore from Backup</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Import a previously exported JSON backup file
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* PWA & Mobile Installation Guide */}
        <div className="card">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Smartphone size={18} color="var(--gk-gold)" />
            PWA App Installation
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.4 }}>
            For the best pitch-side experience without browser address bars:
          </p>
          <ul style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', paddingLeft: '20px', lineHeight: 1.5 }}>
            <li style={{ marginBottom: '6px' }}>
              <strong>iPhone / iPad (Safari)</strong>: Tap the Share button in Safari, then tap <em>"Add to Home Screen"</em>.
            </li>
            <li>
              <strong>Android (Chrome)</strong>: Tap the 3-dots menu, then tap <em>"Install App"</em> or <em>"Add to Home Screen"</em>.
            </li>
          </ul>
        </div>

        {/* Clear Data Card */}
        <div className="card" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
          <div className="card-title" style={{ color: 'var(--danger-red)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Trash2 size={18} />
            Reset Application
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
            Delete all teams, player squads, and historical matches from this device. Make sure to export a backup first if you want to keep your data.
          </p>
          <button
            onClick={() => setShowClearConfirm(true)}
            className="btn btn-ghost"
            style={{ color: 'var(--danger-red)', borderColor: 'rgba(239, 68, 68, 0.4)', border: '1px solid' }}
          >
            Clear All Data
          </button>
        </div>
      </main>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="modal-overlay" onClick={() => setShowClearConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: 'var(--danger-red)' }}>
                Reset All Data?
              </h2>
              <button className="icon-button" onClick={() => setShowClearConfirm(false)}>
                ✕
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '18px' }}>
              This will permanently wipe all local teams, players, matches, and statistics from this device. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setShowClearConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAllData}
                className="btn btn-danger"
                style={{ flex: 2 }}
              >
                Permanently Wipe
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
