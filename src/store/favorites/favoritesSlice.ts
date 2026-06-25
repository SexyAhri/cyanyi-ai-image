import type { StateCreator } from "zustand";
import { dismissAllTooltips } from "../../lib/ui/tooltipDismiss";
import {
  DEFAULT_FAVORITE_COLLECTION_ID,
  createDefaultFavoriteCollection,
  ensureDefaultFavoriteCollection,
  normalizeFavoriteCollections,
  resolveDefaultFavoriteCollectionId,
} from "../../lib/storage/favoriteCollections";
import type { AppState } from "../types";

export type FavoritesSlice = Pick<
  AppState,
  | "favoriteCollections"
  | "setFavoriteCollections"
  | "defaultFavoriteCollectionId"
  | "setDefaultFavoriteCollectionId"
  | "activeFavoriteCollectionId"
  | "isManageCollectionsModalOpen"
  | "setActiveFavoriteCollectionId"
  | "openManageCollectionsModal"
  | "closeManageCollectionsModal"
  | "favoritePickerTaskIds"
  | "openFavoritePicker"
  | "closeFavoritePicker"
>;

export const createFavoritesSlice: StateCreator<AppState, [], [], FavoritesSlice> = (
  set,
) => ({
  favoriteCollections: [createDefaultFavoriteCollection()],
  setFavoriteCollections: (favoriteCollections) =>
    set((state) => {
      const nextCollections = ensureDefaultFavoriteCollection(
        normalizeFavoriteCollections(favoriteCollections),
      );
      return {
        favoriteCollections: nextCollections,
        defaultFavoriteCollectionId: resolveDefaultFavoriteCollectionId(
          nextCollections,
          state.defaultFavoriteCollectionId,
        ),
      };
    }),
  defaultFavoriteCollectionId: DEFAULT_FAVORITE_COLLECTION_ID,
  setDefaultFavoriteCollectionId: (defaultFavoriteCollectionId) =>
    set((state) =>
      defaultFavoriteCollectionId === null ||
      state.favoriteCollections.some(
        (collection) => collection.id === defaultFavoriteCollectionId,
      )
        ? { defaultFavoriteCollectionId }
        : state,
    ),
  activeFavoriteCollectionId: null,
  isManageCollectionsModalOpen: false,
  setActiveFavoriteCollectionId: (activeFavoriteCollectionId) =>
    set({
      activeFavoriteCollectionId,
      selectedTaskIds: [],
      selectedFavoriteCollectionIds: [],
    }),
  openManageCollectionsModal: () =>
    set({ isManageCollectionsModalOpen: true }),
  closeManageCollectionsModal: () =>
    set({ isManageCollectionsModalOpen: false }),
  favoritePickerTaskIds: null,
  openFavoritePicker: (taskIds) => {
    if (!taskIds.length) return;
    dismissAllTooltips();
    set({
      favoritePickerTaskIds: Array.from(new Set(taskIds)).filter(Boolean),
    });
  },
  closeFavoritePicker: () => set({ favoritePickerTaskIds: null }),
});
