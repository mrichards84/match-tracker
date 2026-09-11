'use client';

import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Clock, 
  RefreshCw, 
  ShieldCheck, 
  Zap, 
  X, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2 
} from 'lucide-react';
import { CURRENT_APP_VERSION, CHANGELOG, ChangelogHighlight } from '@/data/changelog';
import { hapticFeedback } from '@/utils/haptics';

const STORAGE_KEY = 'match_tracker_last_seen_version';

export function UpdateSplashScreen() {
  const [isOpen, setIsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    // Check if user has seen this version
    const lastSeenVersion = localStorage.getItem(STORAGE_KEY);

    if (lastSeenVersion !== CURRENT_APP_VERSION) {
      // Delay slightly for smooth initial render
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 500);
      return () => clearTimeout(timer);
    }

    // Listen to manual changelog open requests (e.g. from Settings)
    const handleOpen = () => {
      setIsOpen(true);
    };

    window.addEventListener('open-changelog', handleOpen);
    return () => {
      window.removeEventListener('open-changelog', handleOpen);
    };
  }, []);

  const handleDismiss = () => {
    hapticFeedback.tap();
    localStorage.setItem(STORAGE_KEY, CURRENT_APP_VERSION);
    setIsOpen(false);
  };

  const renderIcon = (iconName: ChangelogHighlight['icon']) => {
    switch (iconName) {
      case 'clock':
        return <Clock size={20} color="var(--pitch-green-light)" />;
      case 'refresh':
        return <RefreshCw size={20} color="var(--sub-blue)" />;
      case 'shield':
        return <ShieldCheck size={20} color="var(--pitch-green)" />;
      case 'zap':
        return <Zap size={20} color="#fbbf24" />;
      case 'sparkles':
      default:
        return <Sparkles size={20} color="#a78bfa" />;
    }
  };

  if (!isOpen) return null;

  const currentRelease = CHANGELOG[0];
  const previousReleases = CHANGELOG.slice(1);

  return (
    <div className="modal-overlay" style={{ zIndex: 100 }} onClick={handleDismiss}>
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '460px',
          border: '1px solid rgba(16, 185, 129, 0.4)',
          background: 'linear-gradient(180deg, #131c28 0%, #0d131a 100%)',
          boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.8), 0 0 25px rgba(16, 185, 129, 0.15)',
          padding: '24px 20px'
        }}
      >
        {/* Top Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(16, 185, 129, 0.05) 100%)',
                border: '1px solid rgba(16, 185, 129, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 15px rgba(16, 185, 129, 0.3)'
              }}
            >
              <Sparkles size={22} color="var(--pitch-green)" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ 
                  fontSize: '0.7rem', 
                  fontWeight: 800, 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.08em',
                  color: 'var(--pitch-green-light)',
                  background: 'rgba(16, 185, 129, 0.15)',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}>
                  What's New
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  v{currentRelease.version}
                </span>
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '2px' }}>
                {currentRelease.title}
              </h2>
            </div>
          </div>

          <button
            onClick={handleDismiss}
            className="icon-button"
            style={{ width: '32px', height: '32px', border: 'none' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Highlight Points */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '16px 0' }}>
          {currentRelease.highlights.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: 'var(--radius-md)',
                padding: '12px'
              }}
            >
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '8px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                {renderIcon(item.icon)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '3px' }}>
                  {item.title}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {item.description}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Older Versions Accordion */}
        {previousReleases.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <button
              onClick={() => {
                hapticFeedback.tap();
                setShowHistory(!showHistory);
              }}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                color: 'var(--text-muted)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                padding: '6px 0'
              }}
            >
              <span>{showHistory ? 'Hide Previous Releases' : 'View Previous Releases'}</span>
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showHistory && (
              <div 
                style={{ 
                  marginTop: '10px', 
                  maxHeight: '160px', 
                  overflowY: 'auto', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '8px',
                  paddingRight: '4px'
                }}
              >
                {previousReleases.map((rel) => (
                  <div
                    key={rel.version}
                    style={{
                      padding: '10px 12px',
                      background: 'rgba(0, 0, 0, 0.2)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid rgba(255, 255, 255, 0.04)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                        v{rel.version} - {rel.title}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {rel.date}
                      </span>
                    </div>
                    {rel.highlights.map((h, i) => (
                      <div key={i} style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '4px' }}>
                        • {h.title}: {h.description}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleDismiss}
          className="btn btn-primary btn-block"
          style={{
            minHeight: '46px',
            fontSize: '0.95rem',
            fontWeight: 700,
            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)'
          }}
        >
          <CheckCircle2 size={18} style={{ marginRight: '6px' }} />
          Got It, Let's Play
        </button>
      </div>
    </div>
  );
}
