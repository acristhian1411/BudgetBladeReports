/**
 * Global error handler middleware
 */
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
  });

  if (err.name === 'MulterError') {
    return res.status(400).json({ error: err.message || 'Invalid file upload' });
  }

  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }

  // Default to 500 for unhandled errors
  res.status(500).json({ error: 'Internal server error' });
};
