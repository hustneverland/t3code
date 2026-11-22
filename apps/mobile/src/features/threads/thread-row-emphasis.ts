import type { ThreadListV2Status } from "./threadListV2";

export function shouldRecedeThreadRow(input: {
  readonly status: ThreadListV2Status;
  readonly selected: boolean;
}): boolean {
  // Working threads sit at the top of this fork's list as the first thing to read, so they stay
  // at full strength; only threads parked on something else recede.
  return !input.selected && input.status === "waiting";
}
