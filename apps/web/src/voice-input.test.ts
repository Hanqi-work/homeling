import { describe, expect, test } from "bun:test";
import { VoiceInput, type AudioRecorder, type VoiceInputDependencies } from "./voice-input.ts";

function fixture() {
  let stopped = 0;
  let calls = 0;
  const recorder: AudioRecorder = {
    state: "inactive", mimeType: "audio/mp4",
    ondataavailable: null, onstop: null, onerror: null,
    start() { this.state = "recording"; },
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["clip"], { type: "audio/mp4" }) });
      this.onstop?.();
    },
  };
  const dependencies: VoiceInputDependencies = {
    getStream: async () => ({ getTracks: () => [{ stop: () => { stopped++; } }] }),
    createRecorder: () => recorder,
    transcribe: async (audio) => { calls++; expect(audio.type).toBe("audio/mp4"); return "请继续"; },
  };
  const drafts: string[] = [];
  const states: string[] = [];
  const voice = new VoiceInput(dependencies, (state) => states.push(state.phase), (text) => drafts.push(text));
  return { voice, dependencies, recorder, drafts, states, stopped: () => stopped, calls: () => calls };
}

describe("voice input recording boundary", () => {
  test("permission denial is visible and can be retried", async () => {
    const f = fixture();
    f.dependencies.getStream = async () => { throw new DOMException("denied", "NotAllowedError"); };
    const states: { phase: string; message: string }[] = [];
    const voice = new VoiceInput(f.dependencies, (state) => states.push(state), () => {});
    await voice.start();
    expect(states.at(-1)).toMatchObject({ phase: "error" });
    expect(states.at(-1)?.message).toContain("麦克风权限被拒绝");
    f.dependencies.getStream = async () => ({ getTracks: () => [] });
    await voice.start();
    expect(states.at(-1)?.phase).toBe("recording");
    voice.cancel();
  });

  test("cancelling during permission releases a late stream without recording", async () => {
    const f = fixture();
    let resolve!: (stream: Awaited<ReturnType<VoiceInputDependencies["getStream"]>>) => void;
    f.dependencies.getStream = () => new Promise((r) => { resolve = r; });
    const start = f.voice.start();
    f.voice.cancel();
    let stopped = 0;
    resolve({ getTracks: () => [{ stop: () => { stopped++; } }] });
    await start;
    expect(stopped).toBe(1);
    expect(f.recorder.state).toBe("inactive");
    expect(f.calls()).toBe(0);
    expect(f.drafts).toEqual([]);
  });

  test("cancelled transcription is aborted and its late result is ignored", async () => {
    const f = fixture();
    let resolve!: (text: string) => void;
    let signal!: AbortSignal;
    f.dependencies.transcribe = (_audio, abort) => { signal = abort; return new Promise((r) => { resolve = r; }); };
    await f.voice.start();
    f.voice.stop();
    f.voice.cancel();
    expect(signal.aborted).toBe(true);
    resolve("旧草稿");
    await Promise.resolve();
    expect(f.drafts).toEqual([]);
    expect(f.stopped()).toBe(1);
  });

  test("recording cancellation never uploads and repeated starts do not acquire twice", async () => {
    const f = fixture();
    let acquisitions = 0;
    const getStream = f.dependencies.getStream;
    f.dependencies.getStream = () => { acquisitions++; return getStream(); };
    await Promise.all([f.voice.start(), f.voice.start()]);
    f.voice.cancel();
    f.voice.cancel();
    expect(acquisitions).toBe(1);
    expect(f.stopped()).toBe(1);
    expect(f.calls()).toBe(0);
  });

  test("recorder setup failure releases tracks and surfaces an error", async () => {
    const f = fixture();
    f.dependencies.createRecorder = () => { throw new Error("录音不可用"); };
    await f.voice.start();
    expect(f.states.at(-1)).toBe("error");
    expect(f.stopped()).toBe(1);
    expect(f.calls()).toBe(0);
  });

  test("provider failure and empty transcript are errors, not replacement drafts", async () => {
    for (const transcribe of [async () => { throw new Error("转写服务忙"); }, async () => " "]) {
      const f = fixture();
      f.dependencies.transcribe = transcribe;
      await f.voice.start(); f.voice.stop();
      await Promise.resolve(); await Promise.resolve();
      expect(f.states.at(-1)).toBe("error");
      expect(f.drafts).toEqual([]);
      expect(f.stopped()).toBe(1);
    }
  });
  test("click start then stop transcribes one clip and releases the microphone", async () => {
    const f = fixture();
    await f.voice.start();
    expect(f.states.at(-1)).toBe("recording");
    f.voice.stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.drafts).toEqual(["请继续"]);
    expect(f.stopped()).toBe(1);
    expect(f.calls()).toBe(1);
    expect(f.states.at(-1)).toBe("idle");
  });
});
