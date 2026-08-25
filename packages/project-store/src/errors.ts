export class ProjectStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProjectStoreError';
  }
}

export class RevisionConflictError extends ProjectStoreError {
  constructor(expected: string | null, actual: string | null) {
    super(
      'REVISION_CONFLICT',
      `Revision conflict: expected ${expected ?? 'none'}, current is ${actual ?? 'none'}`,
      true,
    );
    this.name = 'RevisionConflictError';
  }
}
