import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OrchestrationV2Run, RunId, ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { Atom } from "effect/reactivity";
import { useMemo, useSyncExternalStore } from "react";

import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { environmentThreadDetails } from "../../state/threads";
import { offeredPromptSuggestion } from "./promptSuggestion.logic";

const NO_RUNS_ATOM = Atom.make<ReadonlyArray<OrchestrationV2Run>>([]);

let dismissedKeys: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const subscribeDismissed = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const readDismissed = () => dismissedKeys;
const dismissKey = (environmentId: EnvironmentId, runId: RunId) => `${environmentId}\u0000${runId}`;

export function usePromptSuggestion(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | null;
  readonly latestRun: EnvironmentThreadShell["latestRun"];
  readonly enabled: boolean;
}): { readonly suggestion: string | null; readonly dismiss: () => void } {
  const { environmentId, threadRef, latestRun, enabled } = props;
  const runsAtom = useMemo(
    () =>
      threadRef === null
        ? NO_RUNS_ATOM
        : Atom.make(
            (get) => get(environmentThreadDetails.threadAtom(threadRef))?.projection.runs ?? [],
          ),
    [threadRef],
  );
  const runs = useAtomValue(runsAtom);
  const { data } = useEnvironmentQuery(
    enabled && threadRef !== null && latestRun !== null
      ? orchestrationEnvironment.v2.promptSuggestion({
          environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed);
  const offered = offeredPromptSuggestion(data, latestRun, runs);
  return {
    suggestion:
      offered && !dismissed.has(dismissKey(environmentId, offered.runId)) ? offered.text : null,
    dismiss: () => {
      if (offered === null) return;
      dismissedKeys = new Set(dismissedKeys).add(dismissKey(environmentId, offered.runId));
      for (const listener of listeners) listener();
    },
  };
}
