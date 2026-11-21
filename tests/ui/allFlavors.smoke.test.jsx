import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../src/ai/embeddings.js', () => ({
  generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
  cosineSimilarity: vi.fn(() => 0.8),
}));

import ExtensionApp from '../../src/sidepanel/App.jsx';
import PwaApp from '../../pwa/src/App.jsx';
import { db as extDb } from '../../src/db.js';
import { db as pwaDb } from '../../pwa/src/db.js';

function setViewport(width, userAgent) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(navigator, 'userAgent', { writable: true, configurable: true, value: userAgent });
  window.dispatchEvent(new Event('resize'));
}

describe('Flavor 1: Chrome Extension Side Panel', () => {
  beforeEach(async () => {
    globalThis.__resetChromeStorage();
    await extDb.articles.clear();
    await extDb.briefings.clear();
    self.Summarizer = { availability: vi.fn(async () => 'available'), create: vi.fn(async () => ({ summarize: async () => 'Short digest', destroy: vi.fn() })) };
    self.LanguageModel = { availability: vi.fn(async () => 'available') };
  });

  it('shows 7-day date inputs (no 7D/14D chips), puts Backup/Restore in About, and drains right-click saves', async () => {
    render(<ExtensionApp />);

    expect(screen.queryByText('7D')).not.toBeInTheDocument();
    expect(screen.queryByText('14D')).not.toBeInTheDocument();
    expect(screen.queryByText('Sync List')).not.toBeInTheDocument();

    // Open About and confirm offline JSON Backup & Restore exist
    fireEvent.click(screen.getByRole('button', { name: /About/i }));
    expect(await screen.findByRole('button', { name: /Backup JSON/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restore JSON/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Back$/i }));

    // Simulate right-click context menu save queued in chrome.storage.local
    await chrome.storage.local.set({
      'afterword:pendingSaves': [
        {
          mode: 'link',
          url: 'https://example.com/right-clicked',
          title: 'Right-Clicked Article',
          content: '',
          queuedAt: Date.now(),
        },
      ],
    });

    await waitFor(async () => {
      const saved = await extDb.articles.where('url').equals('https://example.com/right-clicked').first();
      expect(saved).toBeDefined();
      expect(saved.title).toBe('Right-Clicked Article');
    });
  });
});

describe('Flavor 2: Vercel Web App on Desktop (1280x800)', () => {
  beforeEach(async () => {
    setViewport(1280, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0.0.0');
    await pwaDb.articles.clear();
    await pwaDb.briefings.clear();
  });

  it('mounts cleanly on Overview tab, isolates Briefings/Library, and copies installation flags', async () => {
    await pwaDb.briefings.add({
      createdAt: Date.now(),
      startDate: '2026-11-14',
      endDate: '2026-11-21',
      summaryMarkdown: '## Weekly Synthesis\n- Insight one',
      userNotes: '',
    });

    render(<PwaApp />);

    // Overview is active by default — briefing body should not push tutorial down
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveClass('active');
    expect(screen.queryByText('Weekly Synthesis')).not.toBeInTheDocument();
    expect(screen.queryByText('Mobile Companion Workflows')).not.toBeInTheDocument();

    // Click an installation Copy button
    const copyButtons = screen.getAllByRole('button', { name: /Copy/i });
    expect(copyButtons.length).toBeGreaterThan(0);
    fireEvent.click(copyButtons[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    // Switch to Briefings tab
    fireEvent.click(await screen.findByRole('button', { name: /Briefings \(1\)/i }));
    expect(await screen.findByText('Weekly Synthesis')).toBeInTheDocument();
  });
});

describe('Flavor 3: Vercel Web App on Mobile (390x844)', () => {
  beforeEach(async () => {
    setViewport(390, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148');
    await pwaDb.articles.clear();
    await pwaDb.briefings.clear();
  });

  it('renders Mobile Companion Workflows, + Scan Page, and Story/Privacy pills on mobile viewport', async () => {
    render(<PwaApp />);

    expect(await screen.findByText('Mobile Companion Workflows')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Scan Page/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /The Story/i })).toHaveAttribute('href', '/story.html');
    expect(screen.getByRole('link', { name: /Privacy Policy/i })).toHaveAttribute('href', '/privacy.html');
  });
});
