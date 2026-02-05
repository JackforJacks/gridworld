/* TypeScript declarations for @gridworld/simulation */

/** Opaque handle to a Rust SimulationWorld */
export type WorldHandle = object;

/** Create a new simulation world */
export function createWorld(): WorldHandle;

/** Seed initial population */
export function seedPopulation(world: WorldHandle, count: number): void;

/** Run one simulation tick */
export function tick(world: WorldHandle): void;

/** Run multiple ticks */
export function tickMany(world: WorldHandle, count: number): void;

/** Get current entity count */
export function getEntityCount(world: WorldHandle): number;

/** Get estimated memory usage in bytes */
export function getMemoryBytes(world: WorldHandle): number;

/** Get current tick number */
export function getCurrentTick(world: WorldHandle): number;

/** Calendar info */
export interface JsCalendar {
  tick: number;
  month: number;
  year: number;
}

/** Get calendar info */
export function getCalendar(world: WorldHandle): JsCalendar;

/** Benchmark result */
export interface BenchmarkResult {
  totalMs: number;
  perTickMs: number;
  finalPopulation: number;
}

/** Run a benchmark */
export function runBenchmark(initialPopulation: number, ticks: number): BenchmarkResult;
