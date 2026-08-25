import type { OpenMovieDesktopApi } from '../../preload/index.js';

declare global {
  interface Window {
    openMovie: OpenMovieDesktopApi;
  }
}

export {};
