TEST BOILERPLATE — How to add focused tests

Keep tests small and fast. Prefer in-memory/isolated helpers and avoid external services in unit tests.

Suggested workflow:

1. Copy `server/services/__tests__/boilerplate.test.js` -> `server/services/<your-module>.test.js`
2. Replace the tiny `counter` example with the real module or factory under test.
3. Use the repository `MemoryAdapter` (require from `../storage/memoryAdapter`) for storage-dependent tests so they run deterministically and fast.

Useful commands:

- Run a single file: `npm run test:file -- server/services/<your-module>.test.js`
- Run tests by name: `npx jest -t "partial test name"`
- Watch mode for iterative development: `npm run test:watch` or `npm run test:unit:watch`

Tips:
- Keep `beforeEach`/`afterEach` quick and reset only what you need.
- Mock external services (DB, Redis, sockets) for unit tests; add separate integration tests for full-stack behavior.
- Use `test.only` while developing a single test, but remove it before committing.

If you'd like, I can add a short `CONTRIBUTING.md` snippet with this content and a pre-commit sample (husky + lint-staged) to encourage consistent tests.