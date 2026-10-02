import m from "mithril";
import { App, Gif } from "../gifcap";
import Button from "../components/button";
import Timer from "../components/timer";
import View from "../components/view";
import Icon from "../components/icon";
import { humanSize } from "../format";

interface PlayViewAttrs {
  readonly app: App;
  readonly gif: Gif;
}

function pad(value: number, digits: number): string {
  return String(value).padStart(digits, "0");
}

export default class PlayView implements m.ClassComponent<PlayViewAttrs> {
  private readonly app: App;
  private readonly gif: Gif;

  constructor(vnode: m.CVnode<PlayViewAttrs>) {
    this.app = vnode.attrs.app;
    this.gif = vnode.attrs.gif;
  }

  view() {
    const now = new Date();
    const download = `Recording ${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(
      now.getDate(),
      2
    )} at ${pad(now.getHours(), 2)}.${pad(now.getMinutes(), 2)}.${pad(now.getSeconds(), 2)}.gif`;

    const actions = [
      m(Button, {
        label: "Download",
        icon: "download",
        a: {
          href: this.gif.url,
          download,
          target: "_blank",
        },
        primary: true,
      }),
      m(Button, {
        label: "Edit",
        icon: "pencil",
        onclick: () => this.app.editGif(),
      }),
      m(Button, {
        label: "Discard",
        icon: "trashcan",
        onclick: () => this.app.discardGif(),
      }),
    ];

    return [
      m(
        View,
        { actions },
        m(".recording-card", [
          m(
            "a",
            {
              href: this.gif.url,
              download,
              target: "_blank",
            },
            [m("img.recording", { src: this.gif.url })]
          ),
          m("footer", [
            m(Timer, { duration: this.gif.duration }),
            m("span.tag.is-small", { title: "GIF dimensions" }, `${this.gif.width} × ${this.gif.height}`),
            m("span.tag.is-small", [
              m(
                "a.recording-detail",
                {
                  href: this.gif.url,
                  download,
                  target: "_blank",
                },
                [
                  m(Icon, { name: "octicons/download", size: 16, color: "#333333" }),
                  humanSize(this.gif.size),
                ]
              ),
            ]),
          ]),
        ])
      ),
    ];
  }
}
