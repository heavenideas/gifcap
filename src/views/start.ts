import m from "mithril";
import { App } from "../gifcap";
import Button from "../components/button";
import View from "../components/view";
import Onboarding from "../components/onboarding";

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

interface StartViewAttrs {
  readonly app: App;
}

export default class StartView implements m.ClassComponent<StartViewAttrs> {
  private readonly app: App;

  constructor(vnode: m.CVnode<StartViewAttrs>) {
    this.app = vnode.attrs.app;
  }

  view() {
    return m(
      View,
      {
        actions: [],
        contentProps: {
          ondragover: (e: DragEvent & { redraw?: boolean }) => {
            e.preventDefault();
            e.redraw = false;
          },
          ondrop: (e: DragEvent) => {
            e.preventDefault();
            this.openFile(e.dataTransfer?.files[0]);
          },
        },
      },
      [
        m(Onboarding),
        m("p", "Create animated GIFs from a screen recording, or from a video or GIF on your computer."),
        m("p", "Client-side only, no data is uploaded. Modern browser required."),
        isMobile ? m("p", "Sorry, mobile does not support screen recording.") : undefined,
        m("p.start-actions", [
          isMobile
            ? undefined
            : m(Button, {
                label: "Start Recording",
                icon: "play",
                onclick: () => this.app.startRecording(),
                primary: true,
              }),
          m(Button, {
            label: "Open Video or GIF",
            icon: "file-media",
            onclick: (e: MouseEvent) => {
              const input = (e.currentTarget as HTMLElement).parentElement!.querySelector("input")!;
              input.value = "";
              input.click();
            },
          }),
          m("input", {
            type: "file",
            style: { display: "none" }, // chota's input styles override the .hidden class
            accept: "video/*,image/gif",
            onchange: (e: Event) => this.openFile((e.target as HTMLInputElement).files?.[0]),
          }),
        ]),
        m("p.hint", "You can also drop a file here."),
      ]
    );
  }

  private openFile(file: File | undefined): void {
    if (file) {
      this.app.openFile(file);
    }
  }
}
