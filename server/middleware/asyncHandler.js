/**
 * Wraps an async route handler so unhandled rejections
 * get forwarded to Express error middleware instead of crashing.
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
