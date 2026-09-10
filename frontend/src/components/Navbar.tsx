'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Settings, Shield } from 'lucide-react';

interface NavbarProps {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  backHref?: string;
  rightAction?: React.ReactNode;
}

export function Navbar({
  title = 'Match Tracker',
  subtitle,
  showBack = false,
  backHref,
  rightAction
}: NavbarProps) {
  const router = useRouter();

  const handleBack = () => {
    if (backHref) {
      router.push(backHref);
    } else {
      router.back();
    }
  };

  return (
    <header className="header-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {showBack ? (
          <button
            onClick={handleBack}
            className="icon-button"
            aria-label="Go back"
            style={{ width: '38px', height: '38px' }}
          >
            <ArrowLeft size={20} />
          </button>
        ) : (
          <Link href="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', color: 'var(--pitch-green)' }}>
            <Shield size={24} />
          </Link>
        )}

        <div>
          <h1 className="header-title" style={{ margin: 0, fontSize: '1.05rem' }}>
            {title}
          </h1>
          {subtitle && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {rightAction ? (
          rightAction
        ) : (
          <Link href="/settings" className="icon-button" aria-label="Settings">
            <Settings size={18} />
          </Link>
        )}
      </div>
    </header>
  );
}
