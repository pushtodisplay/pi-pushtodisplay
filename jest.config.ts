import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "js", "json"],
  // The package targets NodeNext ESM (pi loads the extension as ESM), but jest
  // runs CommonJS by default — force CJS output for tests only.
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          verbatimModuleSyntax: false,
          allowImportingTsExtensions: true,
        },
        // `index.ts` is the only file that uses `import.meta`, and it sits
        // outside the test roots; ignore the CJS diagnostic in case a test
        // imports it.
        diagnostics: { ignoreCodes: [1343] },
      },
    ],
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/__tests__/**",
  ],
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 50,
      functions: 60,
      lines: 60,
    },
  },
};

export default config;