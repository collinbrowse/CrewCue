/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPTILER_API_KEY?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_CREWCUE_ACCESS_TOKEN?: string;
  readonly VITE_CREWCUE_ROOM_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
