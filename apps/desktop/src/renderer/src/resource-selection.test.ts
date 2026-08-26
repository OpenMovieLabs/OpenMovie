import { describe, expect, it } from 'vitest';

import type { StoryDocuments } from '../../preload/index.js';

import {
  projectResourceCount,
  reconcileResourceSelection,
  storyHasContent,
} from './resource-selection.js';

const project = { id: 'project_demo', root: '/movie', title: 'Demo' } as never;
const emptyStory: StoryDocuments = {
  brief: {
    schema_version: 0,
    title: 'Demo',
    premise: '',
    genres: [],
    audience: '',
    tone: [],
    extensions: {},
  },
  bible: { schema_version: 0, themes: [], world: '', rules: [], extensions: {} },
  screenplay: { schema_version: 0, scenes: [], extensions: {} },
};

describe('desktop resource state', () => {
  it('refreshes a selected entity instead of retaining stale inspector data', () => {
    const oldShot = { id: 'shot_demo', camera: { framing: 'old' } } as never;
    const newShot = { id: 'shot_demo', camera: { framing: 'new' } } as never;
    const selection = reconcileResourceSelection(
      { kind: 'shot', item: oldShot },
      {
        project,
        story: emptyStory,
        characters: [],
        scenes: [],
        shots: [newShot],
        takes: [],
        renders: [],
        revisions: [],
      },
    );
    expect(selection).toEqual({ kind: 'shot', item: newShot });
  });

  it('counts structured Source of Truth resources as well as media', () => {
    expect(storyHasContent(emptyStory)).toBe(false);
    expect(
      projectResourceCount({
        story: { ...emptyStory, bible: { ...emptyStory.bible, world: 'Ocean city' } },
        characterCount: 2,
        sceneCount: 1,
        shotCount: 3,
        takeCount: 1,
        renderCount: 0,
      }),
    ).toBe(8);
  });
});
