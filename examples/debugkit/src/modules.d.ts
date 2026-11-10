// Vite inlines a `?raw` import as the file's text.
declare module "*?raw" {
  const text: string;
  export default text;
}

// Vite bundles the stylesheets imported for their side effects.
declare module "*.css";
