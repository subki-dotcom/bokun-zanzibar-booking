const validateRequest = (schema) => {
  return (req, _res, next) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params
      });

      req.validated = parsed;
      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = validateRequest;