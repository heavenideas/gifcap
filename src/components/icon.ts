import m from "mithril";
import ICONS from "../icons";

interface IconAttrs {
  readonly name: string; // "<set>/<icon>", e.g. "octicons/gear"
  readonly size: number;
  readonly color: string;
  readonly label?: string; // only for icons that carry meaning on their own
}

export default class Icon implements m.ClassComponent<IconAttrs> {
  view(vnode: m.Vnode<IconAttrs>) {
    const icon = ICONS[vnode.attrs.name];

    if (!icon) {
      return null;
    }

    return m(
      "svg.icon",
      {
        width: vnode.attrs.size,
        height: vnode.attrs.size,
        viewBox: icon.viewBox,
        fill: vnode.attrs.color,
        ...(vnode.attrs.label ? { role: "img", "aria-label": vnode.attrs.label } : { "aria-hidden": "true" }),
      },
      icon.paths.map((d) => m("path", { d }))
    );
  }
}
