import { assert } from "./util";
import * as util from "./util";
import * as fbs from "./msg_generated";
import * as flatbuffers from "./flatbuffers";
import { sendSync, sendAsync } from "./bridge";

let nextTimerId = 1;

// tslint:disable-next-line:no-any
export type TimerCallback = (...args: any[]) => void;

interface Timer {
  id: number;
  cb: TimerCallback;
  interval: boolean;
  // tslint:disable-next-line:no-any
  args: any[];
  delay: number; // milliseconds
}

function startTimer(
  id: number,
  cb: TimerCallback,
  delay: number,
  interval: boolean,
  // tslint:disable-next-line:no-any
  args: any[]
): void {
  const timer: Timer = {
    id,
    interval,
    delay,
    args,
    cb
  };
  util.log("timers.ts startTimer");

  // Send TimerStart message
  const builder = flatbuffers.createBuilder();
  fbs.TimerStart.startTimerStart(builder);
  fbs.TimerStart.addId(builder, timer.id);
  fbs.TimerStart.addDelay(builder, timer.delay);
  const msg = fbs.TimerStart.endTimerStart(builder);

  sendAsync(builder, fbs.Any.TimerStart, msg).then(
    baseRes => {
      assert(fbs.Any.TimerReady === baseRes!.msgType());
      const msg = new fbs.TimerReady();
      assert(baseRes!.msg(msg) != null);
      assert(msg.id() === timer.id);
      if (msg.canceled()) {
        util.log("timer canceled message");
      } else {
        cb(...args);
        if (interval) {
          // TODO Faking setInterval with setTimeout.
          // We need a new timer implementation, this is just a stopgap.
          startTimer(id, cb, delay, true, args);
        }
      }
    },
    error => {
      throw error;
    }
  );
}

export function setTimeout(
  cb: TimerCallback,
  delay: number,
  // tslint:disable-next-line:no-any
  ...args: any[]
): number {
  const id = nextTimerId++;
  startTimer(id, cb, delay, false, args);
  return id;
}

export function setInterval(
  cb: TimerCallback,
  delay: number,
  // tslint:disable-next-line:no-any
  ...args: any[]
): number {
  const id = nextTimerId++;
  startTimer(id, cb, delay, true, args);
  return id;
}

export function setImmediate(cb: TimerCallback, ...args: any[]): number {
  return setTimeout(cb, 0, ...args)
}

export function clearTimer(id: number) {
  const builder = flatbuffers.createBuilder();
  fbs.TimerClear.startTimerClear(builder);
  fbs.TimerClear.addId(builder, id);
  const msg = fbs.TimerClear.endTimerClear(builder);
  const res = sendSync(builder, fbs.Any.TimerClear, msg);
  assert(res == null);
}