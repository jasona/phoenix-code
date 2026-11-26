import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigateToMainApp } from "../components/sidebar/mainAppLocation";
import { useMissionControlStore } from "../missionControlStore";
import { useStableCallback } from "./useStableCallback";

export function useOpenMissionControl() {
  const navigateToMainApp = useNavigateToMainApp();
  return useStableCallback(async (environmentId: EnvironmentId) => {
    await navigateToMainApp();
    useMissionControlStore.getState().open(environmentId);
  });
}
