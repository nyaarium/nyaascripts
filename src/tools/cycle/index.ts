import { cycleCheckpoint } from "./tools/cycleCheckpoint.ts";
import { cycleGoto } from "./tools/cycleGoto.ts";
import { cycleList } from "./tools/cycleList.ts";
import { cycleNext } from "./tools/cycleNext.ts";
import { cycleStart } from "./tools/cycleStart.ts";
import { cycleStatus } from "./tools/cycleStatus.ts";

export const toolsCycle = [cycleStart, cycleNext, cycleCheckpoint, cycleStatus, cycleGoto, cycleList];
