// The bundler (and Vite in tests) turns a `?inline` stylesheet import into
// the processed CSS text.
declare module "*.css?inline" {
  const css: string;
  export default css;
}
