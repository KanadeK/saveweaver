export class SaveWeaverError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "SaveWeaverError";
    this.code = options.code ?? "SAVEWEAVER_ERROR";
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details ?? null;
  }
}

export function asSaveWeaverError(error, fallbackCode = "UNEXPECTED_ERROR") {
  if (error instanceof SaveWeaverError) {
    return error;
  }

  return new SaveWeaverError(error instanceof Error ? error.message : String(error), {
    code: fallbackCode,
    cause: error instanceof Error ? error : undefined,
  });
}
