import type { StateCreator } from "zustand";
import type { GalleryTaskFilterStatus } from "../../lib/gallery/galleryTasks";
import type { AppState } from "../types";

export type GallerySlice = Pick<
  AppState,
  | "searchQuery"
  | "setSearchQuery"
  | "filterStatus"
  | "setFilterStatus"
  | "filterFavorite"
  | "setFilterFavorite"
  | "selectedTaskIds"
  | "setSelectedTaskIds"
  | "toggleTaskSelection"
  | "clearSelection"
  | "selectedFavoriteCollectionIds"
  | "setSelectedFavoriteCollectionIds"
  | "toggleFavoriteCollectionSelection"
  | "clearFavoriteCollectionSelection"
>;

export const createGallerySlice: StateCreator<AppState, [], [], GallerySlice> = (
  set,
) => ({
  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  filterStatus: "all" satisfies GalleryTaskFilterStatus,
  setFilterStatus: (filterStatus) => set({ filterStatus }),
  filterFavorite: false,
  setFilterFavorite: (filterFavorite) =>
    set(
      filterFavorite
        ? {
            filterFavorite,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
          }
        : {
            filterFavorite,
            activeFavoriteCollectionId: null,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
          },
    ),
  selectedTaskIds: [],
  setSelectedTaskIds: (updater) =>
    set((state) => ({
      selectedTaskIds:
        typeof updater === "function" ? updater(state.selectedTaskIds) : updater,
    })),
  toggleTaskSelection: (id, force) =>
    set((state) => {
      const isSelected = state.selectedTaskIds.includes(id);
      const shouldSelect = force !== undefined ? force : !isSelected;
      if (shouldSelect === isSelected) return state;
      return {
        selectedTaskIds: shouldSelect
          ? [...state.selectedTaskIds, id]
          : state.selectedTaskIds.filter((item) => item !== id),
      };
    }),
  clearSelection: () => set({ selectedTaskIds: [] }),
  selectedFavoriteCollectionIds: [],
  setSelectedFavoriteCollectionIds: (updater) =>
    set((state) => ({
      selectedFavoriteCollectionIds:
        typeof updater === "function"
          ? updater(state.selectedFavoriteCollectionIds)
          : updater,
    })),
  toggleFavoriteCollectionSelection: (id, force) =>
    set((state) => {
      const isSelected = state.selectedFavoriteCollectionIds.includes(id);
      const shouldSelect = force !== undefined ? force : !isSelected;
      if (shouldSelect === isSelected) return state;
      return {
        selectedFavoriteCollectionIds: shouldSelect
          ? [...state.selectedFavoriteCollectionIds, id]
          : state.selectedFavoriteCollectionIds.filter((item) => item !== id),
      };
    }),
  clearFavoriteCollectionSelection: () =>
    set({ selectedFavoriteCollectionIds: [] }),
});
