// Ambient type declarations for Shopify App Bridge web components.
// These custom elements are injected by App Bridge at runtime and are not
// typed in @shopify/app-bridge-react v4. Declare them as permissive HTML
// elements so TypeScript does not error on JSX usage.
// TODO(PRD-3): replace with official types once @shopify/app-bridge v4 ships them.

declare namespace JSX {
  interface IntrinsicElements {
    "ui-nav-menu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      [key: string]: unknown;
    };
    "ui-save-bar": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      id?: string;
      [key: string]: unknown;
    };
  }
}
