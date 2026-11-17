import { ref, type Ref } from "vue";
import type { RouteFile } from "./types";

const LIBRARY_KEY = "tidal-route-library-v1";

export interface RouteLibrary {
  routes: Ref<RouteFile[]>;
  error: Ref<string>;
  save: (file: RouteFile) => void;
  remove: (id: string) => void;
  replace: (file: RouteFile) => void;
}

function load(): RouteFile[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as RouteFile[]) : [];
  } catch {
    return [];
  }
}

export function createRouteLibrary(): RouteLibrary {
  const routes = ref<RouteFile[]>(load());
  const error = ref("");

  function commit(next: RouteFile[]) {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
      routes.value = next;
      error.value = "";
    } catch {
      error.value = "本地空间不足，路线未保存，请先导出文件";
    }
  }

  return {
    routes,
    error,
    save: (file) => {
      const others = routes.value.filter((r) => r.meta.id !== file.meta.id);
      commit([file, ...others]);
    },
    replace: (file) => {
      commit(routes.value.map((r) => (r.meta.id === file.meta.id ? file : r)));
    },
    remove: (id) => commit(routes.value.filter((r) => r.meta.id !== id)),
  };
}
