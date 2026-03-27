import { getAdapter } from "./adapter/manager";

export const createCollection = async (
  userId: number | string,
  data: { name?: string; cover?: string | null; albumId?: number | string }
) => {
  return await getAdapter().collection.createCollection(userId, data);
};

export const getCollections = async (userId: number | string) => {
  return await getAdapter().collection.getCollections(userId);
};

export const getCollectionById = async (id: number | string) => {
  return await getAdapter().collection.getCollectionById(id);
};

export const updateCollection = async (
  id: number | string,
  data: { name?: string; cover?: string | null }
) => {
  return await getAdapter().collection.updateCollection(id, data);
};

export const uploadCollectionCover = async (id: number | string, file: any) => {
  return await getAdapter().collection.uploadCollectionCover(id, file);
};

export const deleteCollection = async (id: number | string) => {
  return await getAdapter().collection.deleteCollection(id);
};

export const addAlbumToCollection = async (collectionId: number | string, albumId: number | string) => {
  return await getAdapter().collection.addAlbumToCollection(collectionId, albumId);
};

export const removeAlbumFromCollection = async (collectionId: number | string, albumId: number | string) => {
  return await getAdapter().collection.removeAlbumFromCollection(collectionId, albumId);
};

export const reorderCollection = async (collectionId: number | string, albumIds: (number | string)[]) => {
  return await getAdapter().collection.reorderCollection(collectionId, albumIds);
};

export const getCollectionMembership = async (albumId: number | string, userId: number | string) => {
  return await getAdapter().collection.getCollectionMembership(albumId, userId);
};
