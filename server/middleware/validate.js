const MAX_MESSAGE_BYTES = 10 * 1024; // 10KB

/**
 * Parse and validate an integer route param.
 * Returns the integer or throws with status 400.
 */
export function parseId(param) {
  const id = parseInt(param, 10);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('ID must be a positive integer');
    err.status = 400;
    throw err;
  }
  return id;
}

/**
 * Validate a message string — must be non-empty and under 10KB.
 */
export function validateMessage(message) {
  if (!message || typeof message !== 'string') {
    const err = new Error('message is required');
    err.status = 400;
    throw err;
  }
  if (Buffer.byteLength(message, 'utf8') > MAX_MESSAGE_BYTES) {
    const err = new Error('message exceeds 10KB limit');
    err.status = 413;
    throw err;
  }
  return message.trim();
}

/**
 * Validate a local filesystem path — no path traversal.
 */
export function validateLocalPath(localPath) {
  if (!localPath || typeof localPath !== 'string') {
    const err = new Error('localPath is required');
    err.status = 400;
    throw err;
  }
  if (localPath.includes('../') || localPath.includes('..\\')) {
    const err = new Error('localPath contains invalid path traversal');
    err.status = 400;
    throw err;
  }
  return localPath.trim();
}
