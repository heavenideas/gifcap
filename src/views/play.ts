import m from "mithril";
import { App, Gif, Video } from "../gifcap";
import Button from "../components/button";
import Timer from "../components/timer";
import View from "../components/view";
import { downloadName, videoDownloadName } from "../filename";

function humanSize(size: number): string {
  if (size < 1024) {
    return "1 KB";
  }

  size = Math.round(size / 1024);
  return size < 1024 ? `${size} KB` : `${Math.floor((size / 1024) * 100) / 100} MB`;
}

interface PlayViewAttrs {
  readonly app: App;
  readonly gif: Gif;
  readonly video?: Video;
}

export default class PlayView implements m.ClassComponent<PlayViewAttrs> {
  private readonly app: App;
  private readonly gif: Gif;
  private readonly video?: Video;

  constructor(vnode: m.CVnode<PlayViewAttrs>) {
    this.app = vnode.attrs.app;
    this.gif = vnode.attrs.gif;
    this.video = vnode.attrs.video;
  }

  view() {
    const download = downloadName("gif");

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
      this.video
        ? m(Button, {
            label: "Download video",
            icon: "device-camera-video",
            a: {
              href: this.video.url,
              download: videoDownloadName(this.video),
              target: "_blank",
            },
          })
        : undefined,
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
            m("span.tag.is-small", [
              m(
                "a.recording-detail",
                {
                  href: this.gif.url,
                  download,
                  target: "_blank",
                },
                [
                  m("img", {
                    src: "https://icongr.am/octicons/download.svg?size=16&color=333333",
                  }),
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
