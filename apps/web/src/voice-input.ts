import { transcribeAudio } from "./api.ts";

export interface AudioStream { getTracks(): { stop(): void }[] }
export interface AudioRecorder {
  state: string;
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}
export interface VoiceInputDependencies {
  getStream(): Promise<AudioStream>;
  createRecorder(stream: AudioStream): AudioRecorder;
  transcribe(audio: Blob, signal: AbortSignal): Promise<string>;
}
export interface VoiceInputState {
  phase: "idle" | "permission" | "recording" | "transcribing" | "error";
  message: string;
}

export const browserVoiceInput: VoiceInputDependencies = {
  async getStream() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("此浏览器不支持录音，请使用 HTTPS 下的 Safari 或 Chrome。");
    }
    return navigator.mediaDevices.getUserMedia({ audio: true });
  },
  createRecorder(stream) {
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream as MediaStream, mimeType ? { mimeType } : undefined);
    const audio: AudioRecorder = {
      get state() { return recorder.state; },
      get mimeType() { return recorder.mimeType; },
      ondataavailable: null, onstop: null, onerror: null,
      start: (timeslice) => recorder.start(timeslice),
      stop: () => recorder.stop(),
    };
    recorder.ondataavailable = (event) => audio.ondataavailable?.(event);
    recorder.onstop = () => audio.onstop?.();
    recorder.onerror = () => audio.onerror?.();
    return audio;
  },
  transcribe: transcribeAudio,
};

/** One cancellable recording attempt. It returns text, never sends to a pane. */
export class VoiceInput {
  private phase: VoiceInputState["phase"] = "idle";
  private generation = 0;
  private stream: AudioStream | null = null;
  private recorder: AudioRecorder | null = null;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly dependencies: VoiceInputDependencies,
    private readonly onState: (state: VoiceInputState) => void,
    private readonly onTranscript: (text: string) => void,
  ) {}

  private update(phase: VoiceInputState["phase"], message: string): void {
    this.phase = phase;
    this.onState({ phase, message });
  }

  private release(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
      const recorder = this.recorder;
      this.recorder = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // Cancellation still stops the actual microphone tracks below, even if the recorder failed.
      }
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  cancel(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.release();
    this.update("idle", "录音已取消。");
  }

  async start(): Promise<void> {
    if (["permission", "recording", "transcribing"].includes(this.phase)) return;
    const generation = ++this.generation;
    this.update("permission", "正在请求麦克风权限…");
    try {
      const stream = await this.dependencies.getStream();
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const recorder = this.dependencies.createRecorder(stream);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let size = 0;
      recorder.ondataavailable = ({ data }) => {
        size += data.size;
        if (size > 8 * 1024 * 1024) {
          this.cancel();
          this.update("error", "录音过大，请缩短后重试。");
        } else if (data.size) chunks.push(data);
      };
      recorder.onerror = () => {
        this.cancel();
        this.update("error", "录音失败，请检查麦克风后重试。");
      };
      recorder.onstop = () => {
        const audio = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type });
        this.release();
        void this.finish(audio, generation);
      };
      recorder.start(1000);
      this.update("recording", "正在录音，点击停止并转写（最多 60 秒）。");
      this.timer = setTimeout(() => this.stop(), 60_000);
    } catch (error) {
      if (generation !== this.generation) return;
      this.release();
      const name = error instanceof Error ? error.name : "";
      let message = error instanceof Error ? error.message : "无法录音，请检查麦克风后重试。";
      if (name === "NotAllowedError") message = "麦克风权限被拒绝，请在浏览器设置中允许后重试。";
      else if (name === "NotFoundError") message = "未找到麦克风，请连接设备后重试。";
      this.update("error", message);
    }
  }

  stop(): void {
    if (this.phase !== "recording" || !this.recorder) return;
    this.update("transcribing", "正在转写，可取消；不会自动发送。");
    try { this.recorder.stop(); } catch {
      this.cancel();
      this.update("error", "录音失败，请重试。");
    }
  }

  private async finish(audio: Blob, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    this.update("transcribing", "正在转写，可取消；不会自动发送。");
    this.controller = new AbortController();
    try {
      if (!audio.size) throw new Error("录音为空，请重试。");
      const text = await this.dependencies.transcribe(audio, this.controller.signal);
      if (generation !== this.generation) return;
      if (!text.trim()) throw new Error("未识别到语音，请重试。");
      this.controller = null;
      this.update("idle", "转写已加入草稿，请编辑确认后发送。");
      this.onTranscript(text);
    } catch (error) {
      if (generation !== this.generation) return;
      this.controller = null;
      this.update("error", error instanceof Error ? error.message : "转写失败，请重试。");
    }
  }
}
