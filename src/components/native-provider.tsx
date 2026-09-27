"use client";

import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { useEffect } from "react";

import { nativeAuthTarget } from "@/lib/native/auth-link";

/** Native lifecycle events feed the same IndexedDB outbox as the web app. */
export function NativeProvider() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    const listeners: PluginListenerHandle[] = [];
    const keep = async (pending: Promise<PluginListenerHandle>) => {
      const listener = await pending;
      if (disposed) await listener.remove();
      else listeners.push(listener);
    };
    const initialize = async () => {
      const [{ App }, { Network }, { StatusBar, Style }, { Browser }] =
        await Promise.all([
          import("@capacitor/app"),
          import("@capacitor/network"),
          import("@capacitor/status-bar"),
          import("@capacitor/browser"),
        ]);
      if (disposed) return;
      const openSignIn = (url: string) => {
        const target = nativeAuthTarget(url, window.location.origin);
        if (!disposed && target) window.location.assign(target);
      };
      await keep(App.addListener("appUrlOpen", ({ url }) => openSignIn(url)));
      const launch = await App.getLaunchUrl();
      if (launch) openSignIn(launch.url);
      const updateStatusBar = () => {
        const light = document.documentElement.classList.contains("theme-light");
        void StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(
          () => {},
        );
        if (Capacitor.getPlatform() === "android") {
          void StatusBar.setBackgroundColor({
            color: light ? "#ffffff" : "#000000",
          }).catch(() => {});
        }
      };
      updateStatusBar();
      window.addEventListener("transient:theme-applied", updateStatusBar);
      listeners.push({
        remove: async () =>
          window.removeEventListener("transient:theme-applied", updateStatusBar),
      });
      await keep(
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            void Network.getStatus()
              .then(({ connected }) => {
                if (!disposed)
                  window.dispatchEvent(new Event(connected ? "online" : "offline"));
              })
              .catch(() => {});
          }
        }),
      );
      await keep(
        Network.addListener("networkStatusChange", ({ connected }) => {
          window.dispatchEvent(new Event(connected ? "online" : "offline"));
        }),
      );
      if (Capacitor.getPlatform() === "android") {
        await keep(
          App.addListener("backButton", ({ canGoBack }) => {
            if (canGoBack) window.history.back();
            else void App.minimizeApp();
          }),
        );
      }
      // External content never navigates inside the privileged native WebView.
      const onClick = (event: MouseEvent) => {
        const element = event.target instanceof Element ? event.target : null;
        const anchor = element?.closest("a");
        if (!anchor || event.defaultPrevented || anchor.hasAttribute("download"))
          return;
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin && /^https?:$/.test(url.protocol)) {
          event.preventDefault();
          void Browser.open({ url: url.href }).catch(() => {});
        }
      };
      if (disposed) return;
      document.addEventListener("click", onClick);
      listeners.push({
        remove: async () => document.removeEventListener("click", onClick),
      });
    };
    void initialize().catch((error: unknown) =>
      console.error("Native setup failed", error),
    );
    return () => {
      disposed = true;
      for (const listener of listeners) void listener.remove();
    };
  }, []);
  return null;
}
