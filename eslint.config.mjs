import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "src/modules/brain/arcane/**", // vendored ARCANE sources, kept byte-for-byte
    ],
  },
  // Module boundaries (modular monolith): a module is reached only through its public API, src/modules/<name>/index.ts.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/modules/*/*"], message: "Import another module through its public API: @/modules/<name>." }] },
      ],
    },
  },
  {
    files: ["src/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/modules/*/*"], message: "Import another module through its public API: @/modules/<name>." },
            { group: ["../*"], message: "Reach other modules through @/modules/<name>, and the kernel through @/shared/..." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/modules/*", "@/app/*"], message: "The shared kernel can't depend on modules or the app." }] }],
    },
  },
];

export default eslintConfig;

