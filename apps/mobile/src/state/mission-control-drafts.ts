import { createMissionControlDraftStorage } from "@t3tools/client-runtime/plugins/mission-control-drafts";
import Storage from "expo-sqlite/kv-store";

export const missionControlDrafts = createMissionControlDraftStorage(Storage);
