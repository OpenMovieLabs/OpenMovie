import { describe, expect, it } from 'vitest';

import { ensureActiveProject, reconcileRecentProjects } from './project-list.js';

const project = (path: string, title = path, lastOpenedAt = '2026-01-01T00:00:00.000Z') => ({
  path,
  title,
  lastOpenedAt,
});

describe('desktop project list', () => {
  it('keeps the visible project order stable when the backend updates recent timestamps', () => {
    const current = [project('/movie/a', 'A'), project('/movie/b', 'B')];
    const incoming = [
      project('/movie/b', 'B renamed', '2026-02-02T00:00:00.000Z'),
      project('/movie/a', 'A', '2026-01-01T00:00:00.000Z'),
    ];

    expect(reconcileRecentProjects(current, incoming)).toEqual([
      project('/movie/a', 'A', '2026-01-01T00:00:00.000Z'),
      project('/movie/b', 'B renamed', '2026-02-02T00:00:00.000Z'),
    ]);
  });

  it('appends newly opened projects without moving existing projects', () => {
    const current = [project('/movie/a', 'A'), project('/movie/b', 'B')];
    const incoming = [project('/movie/c', 'C'), project('/movie/a', 'A'), project('/movie/b', 'B')];

    expect(reconcileRecentProjects(current, incoming).map((item) => item.path)).toEqual([
      '/movie/a',
      '/movie/b',
      '/movie/c',
    ]);
  });

  it('keeps the active project in its existing slot and only appends it when missing', () => {
    const projects = [project('/movie/a', 'A'), project('/movie/b', 'Old B')];
    const active = { root: '/movie/b', title: 'B' } as Parameters<typeof ensureActiveProject>[1];

    expect(ensureActiveProject(projects, active).map((item) => item.title)).toEqual(['A', 'B']);
    expect(
      ensureActiveProject(projects, { root: '/movie/c', title: 'C' } as typeof active).map(
        (item) => item.path,
      ),
    ).toEqual(['/movie/a', '/movie/b', '/movie/c']);
  });
});
