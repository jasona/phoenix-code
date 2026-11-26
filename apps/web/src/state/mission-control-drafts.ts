import { createMissionControlDraftStorage } from "@t3tools/client-runtime/plugins/mission-control-drafts";

export const missionControlDrafts = createMissionControlDraftStorage({
  getAllKeys: () => Object.keys(window.localStorage),
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
});
