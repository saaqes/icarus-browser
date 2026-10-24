import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Las pruebas del proceso principal (electron/**) se ejecutan en entorno Node, sin DOM.
if (typeof window !== 'undefined') {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  // jsdom no implementa matchMedia: se simula un sistema en modo claro.
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }

  // jsdom no implementa scrollIntoView.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}
