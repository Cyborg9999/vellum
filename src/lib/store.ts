import { create } from "zustand";
import type { Project, RefImage } from "./types";
import {
  listProjects,
  createProject,
  deleteProject,
  updateProject,
  listRefImages,
} from "./db";

interface AppState {
  // Project
  projects: Project[];
  currentProject: Project | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;

  // Reference images (shared across Library + Sidebar thumbnails)
  refImages: RefImage[];

  // Actions
  init: () => Promise<void>;
  selectProject: (project: Project | null) => void;
  newProject: (name: string, description?: string) => Promise<Project>;
  renameProject: (id: number, name: string) => Promise<void>;
  removeProject: (id: number) => Promise<void>;
  patchCurrentProject: (
    patch: Partial<
      Pick<
        Project,
        | "name"
        | "description"
        | "style_prompt"
        | "draft_text"
        | "first_pass_text"
        | "final_pass_text"
      >
    >
  ) => Promise<void>;
  refreshProjects: () => Promise<void>;
  loadRefImages: (projectId: number) => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  projects: [],
  currentProject: null,
  initialized: false,
  loading: false,
  error: null,
  refImages: [],

  init: async () => {
    if (get().initialized) return;
    set({ loading: true, error: null });
    try {
      const projects = await listProjects();
      set({ projects, loading: false, initialized: true });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
        initialized: true,
      });
    }
  },

  selectProject: (project) => {
    set({ currentProject: project, refImages: [] });
    if (project) {
      void get().loadRefImages(project.id);
    }
  },

  newProject: async (name, description = "") => {
    const project = await createProject(name, description);
    set((s) => ({
      projects: [project, ...s.projects],
      currentProject: project,
      refImages: [],
    }));
    return project;
  },

  renameProject: async (id, name) => {
    await updateProject(id, { name });
    const updatedAt = Math.floor(Date.now() / 1000);
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, name, updated_at: updatedAt } : p
      ),
      currentProject:
        s.currentProject?.id === id
          ? { ...s.currentProject, name, updated_at: updatedAt }
          : s.currentProject,
    }));
  },

  removeProject: async (id) => {
    await deleteProject(id);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      currentProject: s.currentProject?.id === id ? null : s.currentProject,
      refImages: s.currentProject?.id === id ? [] : s.refImages,
    }));
  },

  patchCurrentProject: async (patch) => {
    const current = get().currentProject;
    if (!current) return;
    await updateProject(current.id, patch);
    const updated = {
      ...current,
      ...patch,
      updated_at: Math.floor(Date.now() / 1000),
    };
    set((s) => ({
      currentProject: updated,
      projects: s.projects.map((p) => (p.id === current.id ? updated : p)),
    }));
  },

  refreshProjects: async () => {
    const projects = await listProjects();
    set({ projects });
  },

  loadRefImages: async (projectId) => {
    try {
      const imgs = await listRefImages(projectId);
      set({ refImages: imgs });
    } catch (e) {
      console.error("[store] loadRefImages failed:", e);
    }
  },
}));
