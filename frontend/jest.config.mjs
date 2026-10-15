// Jest via next/jest: compiles TS/JSX with Next's SWC and loads next.config + .env like the app does.
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
export default createJestConfig({
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}"],
  modulePathIgnorePatterns: ["<rootDir>/.next/"], // the build output contains a copy of package.json
});
