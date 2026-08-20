const { z } = require("zod");
const { PRIORITY, REVIEW_STATUS, queryPatterns } = require("../services/performanceReview");

const areas = [...new Set(queryPatterns.map((pattern) => pattern.area))];
const models = [...new Set(queryPatterns.map((pattern) => pattern.model))];

const performanceReviewSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({}).optional()
});

const performanceIndexCoverageSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({
    area: z.enum(areas).optional(),
    model: z.enum(models).optional(),
    priority: z.enum(Object.values(PRIORITY)).optional(),
    status: z.enum(Object.values(REVIEW_STATUS)).optional()
  }).optional(),
  body: z.object({}).optional()
});

module.exports = {
  performanceIndexCoverageSchema,
  performanceReviewSchema
};
