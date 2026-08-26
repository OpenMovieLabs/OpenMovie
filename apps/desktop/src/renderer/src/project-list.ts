import type { ProjectSummary } from '@openmovie/contracts';
import type { RecentProject } from '../../preload/index.js';

export function reconcileRecentProjects(
  current: RecentProject[],
  incoming: RecentProject[],
): RecentProject[] {
  const incomingByPath = new Map(incoming.map((item) => [item.path, item]));
  const stableProjects = current.flatMap((item) => {
    const updated = incomingByPath.get(item.path);
    return updated ? [updated] : [];
  });
  const knownPaths = new Set(current.map((item) => item.path));
  return [...stableProjects, ...incoming.filter((item) => !knownPaths.has(item.path))];
}

export function ensureActiveProject(
  projects: RecentProject[],
  activeProject: ProjectSummary | null,
): RecentProject[] {
  if (!activeProject) return projects;
  const index = projects.findIndex((item) => item.path === activeProject.root);
  if (index === -1) {
    return [
      ...projects,
      {
        path: activeProject.root,
        title: activeProject.title,
        lastOpenedAt: '',
      },
    ];
  }
  return projects.map((item, itemIndex) =>
    itemIndex === index ? { ...item, title: activeProject.title } : item,
  );
}
