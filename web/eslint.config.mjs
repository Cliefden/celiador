import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next 15 ships legacy (eslintrc) configs; FlatCompat adapts them
// to the flat config ESLint 9 reads.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
