/// <reference types="vite/client" />

/** Keep navigation inside the repository subpath on GitHub Pages. */
export function sitePath(path = '') {
  return `${import.meta.env.BASE_URL || '/'}${path.replace(/^\/+/, '')}`;
}
