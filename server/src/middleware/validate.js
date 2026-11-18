// zod validation middleware. Parsed (coerced, defaulted) values replace the raw input.
// Express 5 makes req.query a getter, so validated query values go to req.validatedQuery.
export const validateBody = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};

export const validateQuery = (schema) => (req, _res, next) => {
  req.validatedQuery = schema.parse(req.query ?? {});
  next();
};
