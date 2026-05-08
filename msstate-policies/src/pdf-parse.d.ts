// @types/pdf-parse only declares the package root. We import the inner
// module to avoid the index file's test-PDF loader (see docs/BUILD.md).
// Re-route the inner path to the same types as the root.
declare module "pdf-parse/lib/pdf-parse.js" {
  import pdfParse from "pdf-parse";
  export default pdfParse;
}
