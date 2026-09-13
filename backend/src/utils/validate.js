/**
 * Validates an incoming JSON body against a Zod schema and writes a 400
 * response when invalid. Returns the parsed data, or null if it responded.
 */
export const parseBody = (schema, req, res) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: result.error.issues,
    });
    return null;
  }
  return result.data;
};
