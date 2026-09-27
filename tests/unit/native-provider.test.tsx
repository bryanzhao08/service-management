import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NativeProvider } from "@/components/native-provider";

const native = vi.hoisted(() => ({
  enabled: true,
  handlers: new Map<string, (data: Record<string, boolean>) => void>(),
  remove: vi.fn(),
  open: vi.fn().mockResolvedValue(undefined),
  minimize: vi.fn(),
  status: vi.fn().mockResolvedValue({ connected: false }),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.enabled, getPlatform: () => "android" },
}));
vi.mock("@capacitor/app", () => ({
  App: {
    getLaunchUrl: async () => undefined,
    addListener: async (
      event: string,
      handler: (data: Record<string, boolean>) => void,
    ) => {
      native.handlers.set(event, handler);
      return { remove: native.remove };
    },
    minimizeApp: native.minimize,
  },
}));
vi.mock("@capacitor/network", () => ({
  Network: {
    getStatus: native.status,
    addListener: async (
      event: string,
      handler: (data: Record<string, boolean>) => void,
    ) => {
      native.handlers.set(event, handler);
      return { remove: native.remove };
    },
  },
}));
vi.mock("@capacitor/status-bar", () => ({
  Style: { Dark: "DARK" },
  StatusBar: { setStyle: async () => {} },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: native.open } }));

beforeEach(() => {
  native.enabled = true;
  native.handlers.clear();
  vi.clearAllMocks();
});

async function mountNative() {
  const view = render(<NativeProvider />);
  await waitFor(() => expect(native.handlers.has("backButton")).toBe(true));
  return view;
}

describe("native lifecycle", () => {
  it("leaves browser sessions alone", async () => {
    native.enabled = false;
    render(<NativeProvider />);
    await act(async () => {});
    expect(native.handlers.size).toBe(0);
  });

  it("does not report an offline device as online when resumed", async () => {
    await mountNative();
    const online = vi.fn();
    const offline = vi.fn();
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    await act(async () => native.handlers.get("appStateChange")?.({ isActive: true }));
    expect(offline).toHaveBeenCalledOnce();
    expect(online).not.toHaveBeenCalled();
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  });

  it("opens external links outside the native WebView", async () => {
    const view = await mountNative();
    const link = document.createElement("a");
    link.href = "https://example.com/report";
    document.body.appendChild(link);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(native.open).toHaveBeenCalledWith({ url: "https://example.com/report" });
    link.remove();
    view.unmount();
    expect(native.remove).toHaveBeenCalledTimes(4);
  });

  it("preserves Android back navigation and minimizes at the root", async () => {
    await mountNative();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    native.handlers.get("backButton")?.({ canGoBack: true });
    expect(back).toHaveBeenCalledOnce();
    native.handlers.get("backButton")?.({ canGoBack: false });
    expect(native.minimize).toHaveBeenCalledOnce();
    back.mockRestore();
  });
});
