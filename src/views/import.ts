import m from "mithril";
import { App } from "../gifcap";
import Button from "../components/button";
import View from "../components/view";
import { importFile, ImportError, ImportToken } from "../import";

interface ImportViewAttrs {
  readonly app: App;
  readonly file: File;
}

export default class ImportView implements m.ClassComponent<ImportViewAttrs> {
  private readonly app: App;
  private readonly file: File;
  private readonly token: ImportToken = { cancelled: false };

  private progress = 0;

  constructor(vnode: m.CVnode<ImportViewAttrs>) {
    this.app = vnode.attrs.app;
    this.file = vnode.attrs.file;
  }

  async oncreate() {
    try {
      const recording = await importFile(
        this.file,
        (progress) => {
          this.progress = progress;
          m.redraw();
        },
        this.token
      );

      if (recording && !this.token.cancelled) {
        this.app.finishImport(recording);
      }
    } catch (err) {
      if (!(err instanceof ImportError)) {
        console.error(err);
      }

      window.alert(err instanceof ImportError ? err.message : "Sorry, this file couldn't be opened.");
      this.app.cancelImport();
    }
  }

  view() {
    const actions = [
      m(Button, {
        label: "Cancel",
        icon: "square-fill",
        onclick: () => this.cancel(),
      }),
    ];

    return [
      m(View, { actions }, [
        m("p", this.file.name),
        m(
          "progress",
          { max: "1", value: this.progress, title: "Opening..." },
          `Opening: ${Math.floor(this.progress * 100)}%`
        ),
      ]),
    ];
  }

  private cancel(): void {
    this.token.cancelled = true;
    this.app.cancelImport();
  }
}
