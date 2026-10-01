import m from "mithril";
import Icon from "./icon";

function timediff(millis: number): string {
  const abs = Math.floor(millis / 1000);
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  const s = `${secs < 10 ? "0" : ""}${secs}`;
  const m = mins > 0 ? `${mins < 10 ? "0" : ""}${mins}` : "00";
  return `${m}:${s}`;
}

interface TimerAttrs {
  readonly duration: number;
}

export default class Timer implements m.ClassComponent<TimerAttrs> {
  view(vnode: m.Vnode<TimerAttrs>) {
    return m("span.tag.is-small", [
      m(Icon, { name: "octicons/clock", size: 16, color: "#333333" }),
      timediff(vnode.attrs.duration),
    ]);
  }
}
