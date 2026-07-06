# Backend Source Layout

This folder keeps the Express API organized by responsibility.

- `config/`: Environment parsing, database connection, constants, and logger setup.
- `routes/`: API endpoint definitions. Routes choose middleware and call controllers.
- `controllers/`: Request and response handlers. Controllers read `req`, call services, and send JSON responses.
- `services/`: Business logic grouped by feature, for example `bookings/index.js`, `payments/dpo/index.js`, and `bokun/index.js`.
- `middleware/`: Shared Express middleware for auth, RBAC, validation, sanitization, rate limiting, request IDs, and errors.
- `utils/`: Reusable app helpers such as response formatting, quote tokens, and Mongo helpers.
- `validators/`: Zod schemas used by route middleware to validate request bodies, params, and query strings.
- `models/`: Mongoose schemas and models for local persistence.
- `jobs/`: Background workers and pollers that run outside a single HTTP request.
- `integrations/`: Provider-specific clients, mappers, and protocol helpers for Bokun, DPO, Pesapal, PayPal, and future external systems.
- `app.js`: Express app setup only. It wires middleware, health routes, and API routes.

`../server.js` is the process entry point. It loads environment variables, connects to MongoDB, starts Express, and starts background jobs.
