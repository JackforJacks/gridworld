// This file was moved to server/jestGlobalTeardown.js to prevent Jest from treating it as a test file.
// Keep a noop test to avoid failing the suite when running tests directly.
test('noop', () => {
    expect(true).toBe(true);
});