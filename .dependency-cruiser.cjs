/**
 * Layer boundaries (CLAUDE.md "Approved V1 architecture"):
 *   app/ (UI, actions, API) → modules/<name>/service → repositories → platform/db (Prisma)
 * Enforced in CI via `pnpm depcruise`.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "app-no-prisma",
      comment: "app/ must not import Prisma or the database client; go through module services.",
      severity: "error",
      from: { path: "^src/app/" },
      to: { path: ["^src/platform/db/", "node_modules/(@prisma/client|\\.prisma|prisma)/"] },
    },
    {
      name: "app-no-repositories",
      comment: "app/ calls services, never repositories.",
      severity: "error",
      from: { path: "^src/app/" },
      to: { path: "^src/modules/[^/]+/repo\\.ts$" },
    },
    {
      name: "ui-no-domain",
      comment: "src/ui is presentation only: no modules, database or auth.",
      severity: "error",
      from: { path: "^src/ui/" },
      to: { path: ["^src/modules/", "^src/platform/(db|auth|storage)/", "^src/app/"] },
    },
    {
      name: "modules-no-vendor-sdks",
      comment: "Domain modules must not depend on vendor SDKs or the web framework.",
      severity: "error",
      from: { path: "^src/modules/" },
      to: { path: "node_modules/(@aws-sdk|next-auth|@auth|next|nodemailer|openai|@anthropic-ai|@azure|@microsoft|react|react-dom)/" },
    },
    {
      name: "modules-no-app",
      severity: "error",
      from: { path: "^src/modules/" },
      to: { path: ["^src/app/", "^src/ui/"] },
    },
    {
      name: "platform-no-modules",
      comment: "Platform is below modules. Only platform/auth may use the identity module (sign-in eligibility/recording).",
      severity: "error",
      from: { path: "^src/platform/", pathNot: "^src/platform/auth/" },
      to: { path: "^src/modules/" },
    },
    {
      name: "platform-auth-only-identity",
      severity: "error",
      from: { path: "^src/platform/auth/" },
      to: { path: "^src/modules/", pathNot: "^src/modules/identity/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "\\.test\\.ts$" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"] },
  },
};
