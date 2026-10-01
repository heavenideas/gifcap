import m from "mithril";
import fixWebmDuration from "fix-webm-duration";
import { App, Frame, Video } from "../gifcap";
import Button from "../components/button";
import Timer from "../components/timer";
import View from "../components/view";

// first supported type wins; MP4 is preferred since WebM from MediaRecorder lacks duration metadata
const VIDEO_MIME_TYPES = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

// browser defaults are too low to keep screen text crisp
const VIDEO_BITS_PER_SECOND = 8_000_000;

interface VideoRecorder {
  readonly recorder: MediaRecorder;
  readonly chunks: Blob[];
  readonly startTime: number;
  readonly stopped: Promise<{ failed: boolean; stopTime: number }>;
}

function startVideoRecorder(stream: MediaStream): VideoRecorder | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  const mimeType = VIDEO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));

  if (!mimeType) {
    return undefined;
  }

  try {
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    const chunks: Blob[] = [];
    let failed = false;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };
    recorder.onerror = (e) => {
      console.error(e);
      failed = true;
    };

    // the recorder stops on its own when the capture track ends, so the
    // promise must exist before anyone calls stop()
    const stopped = new Promise<{ failed: boolean; stopTime: number }>(
      (c) => (recorder.onstop = () => c({ failed, stopTime: Date.now() }))
    );

    recorder.start(1000);
    return { recorder, chunks, startTime: Date.now(), stopped };
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

async function stopVideoRecorder(videoRecorder: VideoRecorder): Promise<Video | undefined> {
  const recorder = videoRecorder.recorder;

  if (recorder.state !== "inactive") {
    recorder.stop();
  }

  const result = await videoRecorder.stopped;

  if (result.failed || videoRecorder.chunks.length === 0) {
    return undefined;
  }

  const mimeType = recorder.mimeType;
  let blob = new Blob(videoRecorder.chunks, { type: mimeType });

  if (mimeType.startsWith("video/webm")) {
    try {
      blob = await fixWebmDuration(blob, result.stopTime - videoRecorder.startTime, { logger: false });
    } catch (err) {
      console.error(err); // still a playable file, just without duration
    }
  }

  return { blob, url: URL.createObjectURL(blob), mimeType };
}

interface RecordViewAttrs {
  readonly app: App;
  readonly captureStream: MediaStream;
}

export default class RecordView implements m.ClassComponent<RecordViewAttrs> {
  private readonly app: App;
  private readonly captureStream: MediaStream;

  private startTime: number = 0;
  private width: number = 0;
  private height: number = 0;
  private frames: Frame[] = [];
  private videoRecorder: VideoRecorder | undefined;
  private stopping = false;
  private stopTicker: Function | undefined;
  private _onbeforeremove: Function | undefined;

  constructor(vnode: m.CVnode<RecordViewAttrs>) {
    this.app = vnode.attrs.app;
    this.captureStream = vnode.attrs.captureStream;
  }

  async oncreate(vnode: m.VnodeDOM<RecordViewAttrs, this>) {
    const video: HTMLVideoElement = vnode.dom.getElementsByTagName("video")[0];
    const canvas: HTMLCanvasElement = vnode.dom.getElementsByTagName("canvas")[0];

    video.srcObject = this.captureStream;
    this.videoRecorder = startVideoRecorder(this.captureStream);

    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;

    const worker = new Worker("/dist/ticker.js");
    worker.postMessage(this.app.frameLength);
    worker.onmessage = () => {
      if (video.videoWidth === 0) {
        return;
      }

      const first = this.startTime === 0;

      if (first) {
        const width = video.videoWidth;
        const height = video.videoHeight;

        this.startTime = Date.now();
        this.width = width;
        this.height = height;
        canvas.width = width;
        canvas.height = height;
      }

      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, this.width, this.height);

      this.frames.push({
        imageData,
        timestamp: first ? 0 : Date.now() - this.startTime,
      });
    };

    this.stopTicker = () => worker.terminate();

    const redrawInterval = setInterval(() => m.redraw(), this.app.frameLength);

    const track = this.captureStream.getVideoTracks()[0];
    const endedListener = () => this.stopRecording();
    track.addEventListener("ended", endedListener);

    this._onbeforeremove = () => {
      worker.terminate();
      clearInterval(redrawInterval);
      track.removeEventListener("ended", endedListener);
      track.stop();
    };

    m.redraw();
  }

  onbeforeremove(): void {
    this._onbeforeremove && this._onbeforeremove();
  }

  view() {
    return [
      m(View, [
        m("p", [
          m(Timer, {
            duration: this.startTime === 0 ? 0 : Date.now() - this.startTime,
          }),
        ]),
        m(Button, {
          label: "Stop Recording",
          icon: "square-fill",
          disabled: this.stopping,
          onclick: () => this.stopRecording(),
        }),
        m("canvas.hidden", { width: 640, height: 480 }),
        m("video.hidden", { autoplay: true, playsinline: true }),
      ]),
    ];
  }

  private async stopRecording(): Promise<void> {
    if (this.stopping) {
      return;
    }

    this.stopping = true;
    this.stopTicker && this.stopTicker();

    const video = this.videoRecorder && (await stopVideoRecorder(this.videoRecorder));

    this.app.stopRecording({
      width: this.width,
      height: this.height,
      frames: this.frames,
      video,
    });
  }
}
