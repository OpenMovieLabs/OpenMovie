import type {
  DoctorReport,
  ProjectSummary,
  RevisionRecord,
  TakeRecord,
  TimelineRenderRecord,
} from '@openmovie/contracts';
import type { Character, Scene, Shot } from '@openmovie/movie-ir';
import type { StoryDocuments } from '../../preload/index.js';

export type ResourceSelection =
  | { kind: 'project'; item: ProjectSummary }
  | { kind: 'story'; item: StoryDocuments }
  | { kind: 'character'; item: Character }
  | { kind: 'scene'; item: Scene }
  | { kind: 'shot'; item: Shot }
  | { kind: 'take'; item: TakeRecord }
  | { kind: 'render'; item: TimelineRenderRecord }
  | { kind: 'revision'; item: RevisionRecord }
  | { kind: 'doctor'; item: DoctorReport };

export type ProjectResources = {
  project: ProjectSummary;
  story: StoryDocuments;
  characters: Character[];
  scenes: Scene[];
  shots: Shot[];
  takes: TakeRecord[];
  renders: TimelineRenderRecord[];
  revisions: RevisionRecord[];
};

export function reconcileResourceSelection(
  selection: ResourceSelection | null,
  resources: ProjectResources,
): ResourceSelection {
  if (!selection || selection.kind === 'project') {
    return { kind: 'project', item: resources.project };
  }
  if (selection.kind === 'story') return { kind: 'story', item: resources.story };
  if (selection.kind === 'doctor') return selection;
  const collections = {
    character: resources.characters,
    scene: resources.scenes,
    shot: resources.shots,
    take: resources.takes,
    render: resources.renders,
    revision: resources.revisions,
  } as const;
  const current = collections[selection.kind].find((item) => item.id === selection.item.id);
  return current
    ? ({ kind: selection.kind, item: current } as ResourceSelection)
    : { kind: 'project', item: resources.project };
}

export function storyHasContent(story: StoryDocuments | null): boolean {
  if (!story) return false;
  return Boolean(
    story.brief.premise.trim() ||
    story.brief.genres.length ||
    story.brief.audience.trim() ||
    story.brief.tone.length ||
    story.bible.themes.length ||
    story.bible.world.trim() ||
    story.bible.rules.length,
  );
}

export function projectResourceCount(input: {
  story: StoryDocuments | null;
  characterCount: number;
  sceneCount: number;
  shotCount: number;
  takeCount: number;
  renderCount: number;
}): number {
  return (
    (storyHasContent(input.story) ? 1 : 0) +
    input.characterCount +
    input.sceneCount +
    input.shotCount +
    input.takeCount +
    input.renderCount
  );
}

export function storyboardTakeForShot(shot: Shot, takes: TakeRecord[]): TakeRecord | undefined {
  const candidates = takes
    .filter(
      (take) =>
        take.shotId === shot.id &&
        (take.artifact.mimeType.startsWith('image/') ||
          take.artifact.mimeType.startsWith('video/')),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return candidates.find((take) => take.id === shot.selected_take) ?? candidates[0];
}
