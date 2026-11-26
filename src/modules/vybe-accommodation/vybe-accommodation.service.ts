import {
  adjustAccommodationAllocationNight as adjustAllocationNight,
  createAccommodationAllocation as createAllocation,
  createAccommodationProperty as createProperty,
  createAccommodationRoomCategory as createRoomCategory,
  listMyAccommodationProperties,
  releaseAccommodationAllocation as releaseAllocation,
  updateAccommodationPhysicalCapacity
} from "./vybe-accommodation.db.js";

export const createVybeAccommodationProperty = createProperty;
export const listMyVybeAccommodationProperties = listMyAccommodationProperties;
export const createVybeAccommodationRoomCategory = createRoomCategory;
export const updateVybeAccommodationPhysicalCapacity = updateAccommodationPhysicalCapacity;
export const createVybeAccommodationAllocation = createAllocation;
export const adjustVybeAccommodationAllocationNight = adjustAllocationNight;
export const releaseVybeAccommodationAllocation = releaseAllocation;
